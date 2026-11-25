"""鉴权与 JWT。

令牌形态与前端 ``src/services/http.ts`` 一致：``Authorization: Bearer <token>``。

三种鉴权模式（``AUTH_MODE``）：

* ``wechat`` —— 微信小程序 ``wx.login`` code 换 token（生产默认）
* ``dev``    —— 开发登录：code 直接当 openid 用，便于本地联调
* ``none``   —— 不校验 token（个人单机使用，可退化为本地服务）
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable, Dict, Optional

import jwt
from flask import current_app, g, request

from .errors import Forbidden, Unauthorized

__all__ = [
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "current_user",
    "login_required",
    "optional_user",
    "auth_mode",
]


def _secret() -> str:
    return current_app.config.get("JWT_SECRET") or current_app.config["SECRET_KEY"]


def _encode(payload: Dict[str, Any], ttl: int, token_type: str) -> str:
    now = datetime.now(timezone.utc)
    body = {
        **payload,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "typ": token_type,
    }
    return jwt.encode(
        body,
        _secret(),
        algorithm=current_app.config.get("JWT_ALGORITHM", "HS256"),
    )


def create_access_token(user_id: str, **extra: Any) -> str:
    """签发访问令牌。"""
    return _encode({"sub": user_id, **extra}, current_app.config["JWT_ACCESS_TTL"], "access")


def create_refresh_token(user_id: str, **extra: Any) -> str:
    """签发刷新令牌。"""
    return _encode({"sub": user_id, **extra}, current_app.config["JWT_REFRESH_TTL"], "refresh")


def decode_token(token: str, expected_type: str = "access") -> Dict[str, Any]:
    """解析并校验令牌，失败抛 :class:`Unauthorized`。"""
    try:
        payload = jwt.decode(
            token,
            _secret(),
            algorithms=[current_app.config.get("JWT_ALGORITHM", "HS256")],
        )
    except jwt.ExpiredSignatureError:
        raise Unauthorized("登录已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise Unauthorized("登录凭证无效")

    if payload.get("typ") != expected_type:
        raise Unauthorized("登录凭证类型不匹配")
    return payload


def auth_mode() -> str:
    """当前鉴权模式。"""
    return (current_app.config.get("AUTH_MODE") or "none").lower()


def _bearer_token() -> Optional[str]:
    header = request.headers.get("Authorization", "")
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def current_user() -> Optional[Any]:
    """从请求中解析当前用户；未登录或模式为 none 时返回 None。"""
    if "current_user" in g:
        return g.current_user

    user = None
    if auth_mode() != "none":
        token = _bearer_token()
        if token:
            payload = decode_token(token)
            from .extensions import db
            from .models.user import User

            user = db.session.get(User, payload.get("sub"))

    g.current_user = user
    return user


def login_required(func: Callable) -> Callable:
    """要求登录的装饰器。"""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any):
        if auth_mode() == "none":
            g.current_user = None
            return func(*args, **kwargs)

        user = current_user()
        if user is None:
            raise Unauthorized()
        return func(*args, **kwargs)

    return wrapper


def optional_user(func: Callable) -> Callable:
    """可选登录：登录了就带上用户上下文，没登录也能访问。"""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any):
        current_user()
        return func(*args, **kwargs)

    return wrapper


def ensure_owner(record: Any, user: Any) -> None:
    """校验记录归属；``AUTH_MODE=none`` 时跳过。"""
    if auth_mode() == "none" or user is None:
        return
    owner_id = getattr(record, "user_id", None)
    if owner_id is not None and owner_id != user.id:
        raise Forbidden("无权访问该记录")
