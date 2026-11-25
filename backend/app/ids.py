"""ID 生成器。

契约里的 ID 形如 ``bn_01H8X...``（前缀 + ULID），这里实现一个纯 Python 的 ULID：

* 48 位毫秒时间戳 → 保证按创建时间单调递增，天然适合做游标分页的排序键
* 80 位随机数 → 保证同一毫秒内的 ID 不重复

不引入额外依赖，也不依赖数据库自增，避免分库分表与前端 ID 展示的兼容问题。
"""

from __future__ import annotations

import secrets
import time

__all__ = ["new_id", "new_request_id", "new_ulid", "ulid_timestamp_ms"]

#: Crockford Base32（去掉 I/L/O/U，避免手抄混淆）
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _b32(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_ALPHABET[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_ulid() -> str:
    """生成 26 位 ULID。"""
    timestamp = int(time.time() * 1000)
    randomness = secrets.randbits(80)
    return _b32(timestamp, 10) + _b32(randomness, 16)


def new_id(prefix: str = "") -> str:
    """生成带业务前缀的 ID，如 ``bn_01J...``。"""
    ulid = new_ulid()
    return f"{prefix}_{ulid}" if prefix else ulid


def new_request_id() -> str:
    """生成请求追踪 ID，形如 ``req_01J...``。"""
    return new_id("req")


def ulid_timestamp_ms(ulid: str) -> int:
    """从 ULID 还原毫秒时间戳（调试用）。"""
    value = 0
    for ch in ulid[:10].upper():
        value = value * 32 + _ALPHABET.index(ch)
    return value
