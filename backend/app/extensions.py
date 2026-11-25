"""扩展单例。

SQLAlchemy 挂在 app 上；Redis 用一个惰性单例（未配置或不可达时自动降级）。
"""

from __future__ import annotations

from typing import Any, Optional

from flask import current_app
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 声明式基类。"""


db = SQLAlchemy(model_class=Base)

#: Redis 客户端（惰性初始化；不可用时为 None）
_redis_client: Any = None
_redis_ready = False


def init_redis(app) -> None:
    """在应用上下文中初始化 Redis 客户端。"""
    global _redis_client, _redis_ready
    _redis_ready = False
    _redis_client = None

    url = app.config.get("REDIS_URL")
    if not url:
        return

    try:
        import redis  # 延迟导入：未安装 redis 时也能跑

        client = redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        client.ping()
    except Exception as exc:  # pragma: no cover - 取决于部署环境
        app.logger.warning("Redis 不可用，已降级为无缓存模式：%s", exc)
        return

    _redis_client = client
    _redis_ready = True
    app.extensions["ppcoffe_redis"] = client


def get_redis():
    """获取 Redis 客户端；不可用时返回 None。"""
    return _redis_client if _redis_ready else None


def redis_available() -> bool:
    return _redis_ready and _redis_client is not None
