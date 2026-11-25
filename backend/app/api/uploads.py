"""上传接口：``/api/v1/uploads``。

前端流程（docs/02-接口契约.md 第 5.5.3 节）：

    pickImages → presign → Taro.uploadFile(PUT uploadUrl) → 用 objectKey + publicUrl 关联记录

图片流量不经过应用服务器（预签名直传）；``POST /uploads`` 仅作为直传兜底。
"""

from __future__ import annotations

import base64
import binascii
import mimetypes
import os
import uuid
from typing import Any, Dict, Tuple

from flask import Blueprint, Response, current_app, request, send_file

from ..envelope import ok
from ..errors import InvalidParam, NotFound, ValidationFailed
from ..extensions import db
from ..ids import new_id
from ..models.misc import Upload
from ..schemas import PresignSchema, UploadCreateSchema
from ..security import current_user
from ..services.storage import LocalStorage, get_storage
from .helpers import parse_with

bp = Blueprint("uploads", __name__)

#: 预签名有效期（秒）
PRESIGN_TTL = 3600


def _guess_ext(filename: str, content_type: str | None = None) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext and len(ext) <= 6:
        return ext
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed:
            return guessed
    return ".jpg"


def _build_object_key(purpose: str, filename: str, content_type: str | None) -> str:
    """对象键：``{用途}/{用户}/{uuid}.{ext}``，便于按记录清理。"""
    user = current_user()
    owner = user.id if user else "local"
    return f"{purpose}/{owner}/{uuid.uuid4().hex}{_guess_ext(filename, content_type)}"


@bp.post("/presign")
def presign():
    """申请直传目标（预签名 PUT）。"""
    data = parse_with(PresignSchema())
    purpose = data.get("purpose") or "brew"
    object_key = _build_object_key(purpose, data["filename"], data.get("contentType"))

    storage = get_storage()
    upload_url = storage.presign_put(object_key, data.get("contentType") or "image/jpeg", PRESIGN_TTL)
    public_url = storage.public_url(object_key)

    return ok(
        {
            "objectKey": object_key,
            "uploadUrl": upload_url,
            "publicUrl": public_url,
            "headers": {"Content-Type": data.get("contentType") or "image/jpeg"},
            "expiresIn": PRESIGN_TTL,
        }
    )


@bp.post("")
def upload():
    """直传兜底：multipart 或 base64 data URI 由后端接收并转存。"""
    data = parse_with(UploadCreateSchema())

    content = b""
    content_type = data.get("contentType")
    size_bytes = data.get("sizeBytes") or 0

    if request.files:
        file = next(iter(request.files.values()))
        content = file.read()
        content_type = content_type or file.mimetype
        size_bytes = size_bytes or len(content)
    elif data.get("dataUri"):
        raw = data["dataUri"]
        if raw.startswith("data:"):
            header, _, payload = raw.partition(",")
            if "base64" in header:
                content_type = content_type or header[5:].split(";")[0]
            try:
                content = base64.b64decode(payload)
            except (binascii.Error, ValueError):
                raise ValidationFailed("dataUri 解析失败", field="dataUri")
        else:
            content = raw.encode("utf-8")
    else:
        raise ValidationFailed("缺少文件内容", field="dataUri")

    if not content:
        raise ValidationFailed("文件内容为空", field="dataUri")

    object_key = _build_object_key("brew", data["filename"], content_type)
    storage = get_storage()
    public_url = storage.put_object(object_key, content, content_type or "application/octet-stream")

    user = current_user()
    record = Upload(
        id=new_id("img"),
        user_id=user.id if user else None,
        object_key=object_key,
        bucket=None,
        url=public_url,
        content_type=content_type,
        size_bytes=size_bytes or len(content),
        caption=data.get("caption"),
    )
    db.session.add(record)
    db.session.commit()

    return ok(record.to_dict(), status=201)


@bp.delete("")
def delete_upload():
    """删除对象。"""
    object_key = request.args.get("objectKey")
    if not object_key:
        raise InvalidParam("缺少 objectKey 参数", field="objectKey")

    storage = get_storage()
    try:
        storage.delete_object(object_key)
    except Exception:
        pass

    record = db.session.query(Upload).filter(Upload.object_key == object_key).one_or_none()
    if record is not None:
        db.session.delete(record)
        db.session.commit()

    return ok({"ok": True})


# --------------------------------------------------------------------- #
#  本地存储驱动专用的直传端点（STORAGE_DRIVER=local 时启用）
# --------------------------------------------------------------------- #


@bp.put("/local/<path:object_key>")
def local_put(object_key: str):
    """本地驱动的直传落地端点。"""
    storage = get_storage()
    if not isinstance(storage, LocalStorage):
        raise NotFound("本地存储驱动未启用")

    signature = request.args.get("signature", "")
    if not storage._verify(object_key, signature):
        raise InvalidParam("上传签名无效或已过期", field="signature")

    content = request.get_data()
    if not content:
        raise ValidationFailed("上传内容为空")

    storage.put_object(object_key, content, request.headers.get("Content-Type", "application/octet-stream"))
    return ok({"ok": True, "objectKey": object_key})


@bp.get("/local/<path:object_key>")
def local_get(object_key: str):
    """读取本地存储中的对象。"""
    storage = get_storage()
    if not isinstance(storage, LocalStorage):
        raise NotFound("本地存储驱动未启用")
    if not storage.exists(object_key):
        raise NotFound("对象不存在")
    return send_file(storage._path(object_key), conditional=True)
