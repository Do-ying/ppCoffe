"""Redis 缓存封装。

Redis 是**可选**依赖：未配置或不可达时所有函数退化为「不缓存」，
接口行为不变，只是每次都实时计算。

目前用于：

* ``GET /methods`` / ``GET /flavor-wheel`` —— 元数据强缓存（TTL 1h）
* ``GET /stats/summary`` —— 统计快照（TTL 60s），写入后主动失效
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from flask import current_app

from ..extensions import get_redis, redis_available

__all__ = ["cache_get_json", "cache_set_json", "invalidate", "cached"]


def _key(namespace: str, key: str) -> str:
    prefix = current_app.config.get("REDIS_NAMESPACE", "ppcoffe")
    return f"{prefix}:{namespace}:{key}"


def cache_get_json(namespace: str, key: str) -> Optional[Any]:
    """读缓存；未命中或 Redis 不可用时返回 None。"""
    if not redis_available():
        return None
    try:
        raw = get_redis().get(_key(namespace, key))
    except Exception:  # pragma: no cover - Redis 抖动不应影响主流程
        current_app.logger.warning("读取缓存失败，已降级为实时计算")
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def cache_set_json(namespace: str, key: str, value: Any, ttl: Optional[int] = None) -> None:
    """写缓存。"""
    if not redis_available():
        return
    if ttl is None:
        ttl = current_app.config.get("CACHE_TTL_METADATA", 3600)
    try:
        get_redis().setex(_key(namespace, key), ttl, json.dumps(value, ensure_ascii=False))
    except Exception:  # pragma: no cover
        current_app.logger.warning("写入缓存失败，忽略")


def invalidate(namespace: str, key: str = "*") -> None:
    """失效缓存。"""
    if not redis_available():
        return
    try:
        client = get_redis()
        pattern = _key(namespace, key)
        if key == "*":
            for found in client.scan_iter(match=pattern, count=200):
                client.delete(found)
        else:
            client.delete(pattern)
    except Exception:  # pragma: no cover
        current_app.logger.warning("清理缓存失败，忽略")


def cached(namespace: str, key: str, producer: Callable[[], Any], ttl: Optional[int] = None) -> Any:
    """典型的「读缓存 → 未命中则计算 → 回填」包装。"""
    hit = cache_get_json(namespace, key)
    if hit is not None:
        return hit
    value = producer()
    cache_set_json(namespace, key, value, ttl)
    return value
