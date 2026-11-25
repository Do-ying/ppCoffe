"""认证接口：``/api/v1/auth``。

* ``POST /wechat``  —— 微信小程序 code 换 token
* ``POST /refresh`` —— 刷新 token
* ``GET  /me``      —— 当前用户
"""

from __future__ import annotations

from typing import Any, Dict

import requests
from flask import Blueprint, current_app

from ..envelope import ok
from ..errors import ApiError, Unauthorized
from ..extensions import db
from ..ids import new_id
from ..models.user import User
from ..schemas import RefreshSchema, WechatAuthSchema
from ..security import create_access_token, create_refresh_token, current_user, decode_token
from .helpers import json_body, parse_with

bp = Blueprint("auth", __name__)


def _exchange_wechat_code(code: str) -> Dict[str, Any]:
    """用 code 换 openid（微信 jscode2session）。"""
    appid = current_app.config.get("WECHAT_APPID")
    secret = current_app.config.get("WECHAT_SECRET")
    if not appid or not secret:
        raise ApiError(
            "未配置微信小程序凭据，无法完成登录",
            code="INVALID_PARAM",
            status=400,
            details={"hint": "请设置 WECHAT_APPID / WECHAT_SECRET，或将 AUTH_MODE 设为 dev"},
        )

    url = f"{current_app.config['WECHAT_API_BASE'].rstrip('/')}/sns/jscode2session"
    try:
        resp = requests.get(
            url,
            params={"appid": appid, "secret": secret, "js_code": code, "grant_type": "authorization_code"},
            timeout=5,
        )
        payload = resp.json()
    except Exception as exc:  # pragma: no cover - 依赖外部服务
        raise ApiError(f"微信登录服务不可用：{exc}", code="INTERNAL", status=502)

    if payload.get("errcode"):
        raise Unauthorized(f"微信登录失败：{payload.get('errmsg', '未知错误')}")
    if not payload.get("openid"):
        raise Unauthorized("微信登录失败：未返回 openid")
    return payload


def _resolve_openid(code: str) -> Dict[str, Any]:
    """按鉴权模式解析登录标识。"""
    mode = (current_app.config.get("AUTH_MODE") or "dev").lower()
    if mode == "wechat":
        return _exchange_wechat_code(code)
    # dev / none：把 code 当作稳定标识使用，便于本地联调
    return {"openid": f"dev_{code}"}


@bp.post("/wechat")
def wechat_login():
    """微信 code 换 token。"""
    data = parse_with(WechatAuthSchema())
    payload = _resolve_openid(data["code"])
    openid = payload["openid"]

    user = db.session.query(User).filter(User.openid == openid).one_or_none()
    if user is None:
        user = User(
            id=new_id("us"),
            openid=openid,
            unionid=payload.get("unionid"),
            nickname=data.get("nickname"),
            avatar_url=data.get("avatarUrl"),
        )
        db.session.add(user)
        db.session.commit()

    access = create_access_token(user.id, openid=user.openid)
    refresh = create_refresh_token(user.id)
    return ok({"token": access, "refreshToken": refresh, "user": user.to_dict()})


@bp.post("/refresh")
def refresh_token():
    """刷新访问令牌。"""
    data = parse_with(RefreshSchema())
    payload = decode_token(data["refreshToken"], expected_type="refresh")
    user = db.session.get(User, payload.get("sub"))
    if user is None:
        raise Unauthorized("用户不存在，请重新登录")

    access = create_access_token(user.id, openid=user.openid)
    refresh = create_refresh_token(user.id)
    return ok({"token": access, "refreshToken": refresh, "user": user.to_dict()})


@bp.get("/me")
def me():
    """当前用户信息。"""
    user = current_user()
    if user is None:
        return ok(
            {
                "id": "",
                "nickname": "",
                "avatarUrl": "",
                "anonymous": True,
            }
        )
    return ok(user.to_dict())
