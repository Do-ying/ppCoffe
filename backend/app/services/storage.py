"""对象存储抽象（MinIO 为主，本地文件系统兜底）。

前端不绑定任何存储实现（见 docs/02-接口契约.md 第 5.5.3 节），
只消费后端下发的 ``objectKey`` / ``uploadUrl`` / ``publicUrl`` 三个字段。

两种驱动：

* ``minio`` —— 生产环境。桶建议按用途分桶（``ppcoffe-brew`` / ``ppcoffe-roast``），
  私有桶 + 预签名 GET；前端通过预签名 PUT 直传，图片流量不经过应用服务器。
* ``local`` —— 本地联调兜底，把对象写到磁盘，并暴露一个本地上传端点，
  让「预签名直传」的完整链路在没有 MinIO 时也能跑通。
"""

from __future__ import annotations

import base64
import binascii
import os
import time
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from flask import current_app

__all__ = ["get_storage", "StorageService", "MinioStorage", "LocalStorage"]


class StorageService:
    """存储接口基类。"""

    def presign_put(self, object_key: str, content_type: str, expires: int) -> str:
        raise NotImplementedError

    def presign_get(self, object_key: str, expires: int) -> str:
        raise NotImplementedError

    def put_object(self, object_key: str, data: bytes, content_type: str) -> str:
        raise NotImplementedError

    def delete_object(self, object_key: str) -> None:
        raise NotImplementedError

    def public_url(self, object_key: str) -> str:
        raise NotImplementedError

    def exists(self, object_key: str) -> bool:
        raise NotImplementedError


class MinioStorage(StorageService):
    """MinIO / S3 兼容实现。"""

    def __init__(self) -> None:
        from minio import Minio

        cfg = current_app.config
        #: 显式指定 region，避免 SDK 在预签名时发 GetBucketLocation 网络请求
        #: （minio-py 的 _get_region 在未指定 region 时会联网查桶位置，
        #:   既拖慢接口，又让预签名依赖 MinIO 实时可达）。
        region = cfg.get("MINIO_REGION") or "us-east-1"

        self.client = Minio(
            cfg["MINIO_ENDPOINT"],
            access_key=cfg["MINIO_ACCESS_KEY"],
            secret_key=cfg["MINIO_SECRET_KEY"],
            secure=cfg["MINIO_SECURE"],
            region=region,
        )
        #: 预签名专用客户端。
        #: SigV4 签名把 Host 计入签名，所以生成的 URL 里的主机名
        #: 必须与前端实际直传的地址一致 —— 容器内网名（minio:9000）前端解析不了，
        #: 用外网地址签名才能直传成功。预签名是本地计算，不产生服务端请求。
        public_endpoint = (cfg.get("MINIO_PUBLIC_ENDPOINT") or "").strip()
        self.presign_client = None
        if public_endpoint and public_endpoint != cfg["MINIO_ENDPOINT"]:
            self.presign_client = Minio(
                public_endpoint,
                access_key=cfg["MINIO_ACCESS_KEY"],
                secret_key=cfg["MINIO_SECRET_KEY"],
                secure=cfg["MINIO_SECURE"],
                region=region,
            )
        self.buckets = {
            "brew": cfg["MINIO_BUCKET_BREW"],
            "roast": cfg["MINIO_BUCKET_ROAST"],
            "tmp": cfg["MINIO_BUCKET_TEMP"],
        }
        self.public_base = (cfg.get("MINIO_PUBLIC_BASE_URL") or "").rstrip("/")
        self.url_ttl = int(cfg.get("MINIO_URL_TTL", 7 * 24 * 3600))

    # -- 桶 --

    def bucket_for(self, object_key: str) -> str:
        """按对象键前缀选桶。"""
        prefix = object_key.split("/", 1)[0]
        return self.buckets.get(prefix, self.buckets["brew"])

    def ensure_buckets(self) -> None:
        """确保三个桶存在（首次启动时调用）。"""
        for bucket in set(self.buckets.values()):
            if not self.client.bucket_exists(bucket):
                self.client.make_bucket(bucket)

    # -- 预签名 --

    def presign_put(self, object_key: str, content_type: str, expires: int) -> str:
        """预签名 PUT 直传地址。

        minio-py 7.2.x 的 ``presigned_put_object`` 只接受
        (bucket, object, expires) —— 传 content_type 会直接 TypeError，
        所以 Content-Type 不参与签名，由调用方在直传时带上即可
        （SigV4 只校验 SignedHeaders 里列出的头，未签名的头不影响校验）。
        """
        client = self.presign_client or self.client
        return client.presigned_put_object(
            self.bucket_for(object_key),
            object_key,
            expires=timedelta(seconds=expires),
        )

    def presign_get(self, object_key: str, expires: int) -> str:
        client = self.presign_client or self.client
        return client.presigned_get_object(
            self.bucket_for(object_key),
            object_key,
            expires=timedelta(seconds=expires),
        )

    # -- 直接写入 --

    def put_object(self, object_key: str, data: bytes, content_type: str) -> str:
        import io

        self.client.put_object(
            self.bucket_for(object_key),
            object_key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type or "application/octet-stream",
        )
        return self.public_url(object_key)

    def delete_object(self, object_key: str) -> None:
        self.client.remove_object(self.bucket_for(object_key), object_key)

    def exists(self, object_key: str) -> bool:
        try:
            self.client.stat_object(self.bucket_for(object_key), object_key)
            return True
        except Exception:
            return False

    def public_url(self, object_key: str) -> str:
        """访问地址。

        配置了 CDN / 反代域名就返回稳定地址，否则退化为预签名 GET
        （私有桶 + 签名读，避免公开暴露对象）。
        """
        if self.public_base:
            return f"{self.public_base}/{self.bucket_for(object_key)}/{object_key}"
        return self.presign_get(object_key, self.url_ttl)


class LocalStorage(StorageService):
    """本地文件系统兜底实现。

    预签名 PUT 指向本服务的 ``PUT /api/v1/uploads/local/<object_key>``，
    让前端「预签名直传」的链路在没有 MinIO 时也能完整跑通。
    """

    def __init__(self) -> None:
        self.root = Path(current_app.config["LOCAL_STORAGE_ROOT"]).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.url_ttl = int(current_app.config.get("MINIO_URL_TTL", 7 * 24 * 3600))

    def _path(self, object_key: str) -> Path:
        # 防目录穿越
        safe = os.path.normpath(object_key).lstrip("/")
        if safe.startswith(".."):
            raise ValueError("非法的对象键")
        return self.root / safe

    def _sign(self, object_key: str, expires: int) -> str:
        secret = current_app.config.get("SECRET_KEY", "")
        expires_at = int(time.time()) + expires
        payload = f"{object_key}:{expires_at}".encode("utf-8")
        signature = base64.urlsafe_b64encode(_hmac(secret, payload)).decode("ascii").rstrip("=")
        return f"{expires_at}.{signature}"

    def _verify(self, object_key: str, signature: str) -> bool:
        try:
            expires_at, sig = signature.split(".", 1)
            if int(expires_at) < int(time.time()):
                return False
        except (ValueError, AttributeError):
            return False
        secret = current_app.config.get("SECRET_KEY", "")
        expected = self._sign(object_key, int(expires_at) - int(time.time()))
        expected_sig = expected.split(".", 1)[1]
        return _safe_equal(sig, expected_sig)

    def presign_put(self, object_key: str, content_type: str, expires: int) -> str:
        base = current_app.config.get("PUBLIC_BASE_URL", "").rstrip("/")
        return (
            f"{base}{current_app.config['API_PREFIX']}/uploads/local/{object_key}"
            f"?signature={self._sign(object_key, expires)}"
        )

    def presign_get(self, object_key: str, expires: int) -> str:
        base = current_app.config.get("PUBLIC_BASE_URL", "").rstrip("/")
        return f"{base}{current_app.config['API_PREFIX']}/uploads/local/{object_key}"

    def put_object(self, object_key: str, data: bytes, content_type: str) -> str:
        path = self._path(object_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return self.public_url(object_key)

    def delete_object(self, object_key: str) -> None:
        path = self._path(object_key)
        if path.exists():
            path.unlink()

    def exists(self, object_key: str) -> bool:
        return self._path(object_key).exists()

    def public_url(self, object_key: str) -> str:
        base = current_app.config.get("PUBLIC_BASE_URL", "").rstrip("/")
        return f"{base}{current_app.config['API_PREFIX']}/uploads/local/{object_key}"

    def read(self, object_key: str) -> bytes:
        return self._path(object_key).read_bytes()


def _hmac(secret: str, payload: bytes) -> bytes:
    import hmac
    import hashlib

    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()


def _safe_equal(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


_storage: Optional[StorageService] = None


def get_storage() -> StorageService:
    """获取存储实例（进程内单例）。"""
    global _storage
    if _storage is None:
        driver = (current_app.config.get("STORAGE_DRIVER") or "local").lower()
        if driver == "minio":
            _storage = MinioStorage()
        else:
            _storage = LocalStorage()
    return _storage


def reset_storage() -> None:
    """重置存储实例（测试用）。"""
    global _storage
    _storage = None
