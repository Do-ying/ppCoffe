"""API 层公共helper：请求体解析、校验、游标分页、排序。"""

from __future__ import annotations

import base64
import binascii
import json
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from flask import current_app, request
from marshmallow import Schema, ValidationError
from sqlalchemy import and_, or_
from sqlalchemy.orm import Query

from ..errors import InvalidParam, NotFound, ValidationFailed
from ..security import current_user

__all__ = [
    "json_body",
    "parse_with",
    "encode_cursor",
    "decode_cursor",
    "paginate",
    "parse_sort",
    "parse_int",
    "parse_bool",
    "parse_date",
    "parse_datetime",
    "require_fields",
    "scope",
    "page_size",
]


# --------------------------------------------------------------------- #
#  请求体
# --------------------------------------------------------------------- #


def json_body() -> Dict[str, Any]:
    """取 JSON 请求体；不是合法 JSON 对象时抛 400。"""
    body = request.get_json(silent=True)
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise InvalidParam("请求体必须是 JSON 对象")
    return body


def parse_with(schema: Schema, *, partial: bool = False, data: Any = None) -> Dict[str, Any]:
    """用 marshmallow schema 校验数据，失败抛 422 VALIDATION_FAILED。"""
    payload = json_body() if data is None else data
    try:
        return schema.load(payload, partial=partial)
    except ValidationError as exc:
        messages = exc.messages
        field = None
        if isinstance(messages, dict) and messages:
            field = next(iter(messages))
        elif isinstance(messages, list) and messages:
            field = None
        raise ValidationFailed(
            "参数校验失败",
            details={"errors": messages},
            field=field,
        )


def require_fields(data: Dict[str, Any], fields: Sequence[str]) -> None:
    """校验必填字段。"""
    missing = [f for f in fields if data.get(f) in (None, "")]
    if missing:
        raise ValidationFailed(
            "缺少必填字段", details={"missing": missing}, field=missing[0]
        )


def scope(query: Query, model: Any = None):
    """按当前用户过滤查询。

    ``AUTH_MODE=none``（个人单机）或未登录时不做隔离，便于本地直接使用。
    """
    user = current_user()
    if user is None:
        return query
    return query.filter(model.user_id == user.id)


def page_size(default: int = 20) -> int:
    """从 query string 读取分页大小。"""
    from flask import current_app as _app

    raw = request.args.get("limit")
    size = parse_int(raw, default or _app.config.get("DEFAULT_PAGE_SIZE", 20), name="limit")
    return max(1, min(size or 20, _app.config.get("MAX_PAGE_SIZE", 100)))


# --------------------------------------------------------------------- #
#  游标分页
# --------------------------------------------------------------------- #


def encode_cursor(payload: Dict[str, Any]) -> str:
    """把分页游标编码成不透明字符串。"""
    raw = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: Optional[str]) -> Optional[Dict[str, Any]]:
    """解码分页游标；非法游标抛 400。"""
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise InvalidParam("游标格式不合法")


def parse_int(value: Any, default: Optional[int] = None, *, name: str = "limit") -> Optional[int]:
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        raise InvalidParam(f"参数 {name} 必须是整数")


def parse_bool(value: Any, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_date(value: Any, *, name: str) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise InvalidParam(f"参数 {name} 必须是 YYYY-MM-DD 格式")


def parse_datetime(value: Any, *, name: str) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).replace(tzinfo=None)
    except ValueError:
        raise InvalidParam(f"参数 {name} 必须是 ISO 8601 时间")


def parse_sort(
    raw: Optional[str], allowed: Dict[str, Any], default: str
) -> List[Tuple[Any, bool]]:
    """解析 ``?sort=-brewDate,createdAt``。

    :param allowed: 允许排序的字段 → ORM 列
    :param default: 默认排序字段
    :return: [(列, 是否降序), ...]
    """
    if not raw:
        raw = default
    result: List[Tuple[Any, bool]] = []
    for token in str(raw).split(","):
        token = token.strip()
        if not token:
            continue
        desc = token.startswith("-")
        name = token[1:] if desc else token
        if name not in allowed:
            raise InvalidParam(
                f"不支持的排序字段：{name}",
                details={"allowed": list(allowed.keys())},
            )
        result.append((allowed[name], desc))
    if not result:
        result = [(allowed[default], False)]
    return result


def paginate(
    query: Query,
    *,
    model: Any,
    sort_fields: List[Tuple[Any, bool]],
    cursor: Optional[str] = None,
    limit: int = 20,
) -> Tuple[List[Any], Optional[str], bool]:
    """游标（keyset）分页。

    游标记录上一页最后一条的排序键值，查询条件为「严格排在它之后」。
    offset 分页在数据量大时会退化，契约要求统一用游标。

    :return: (本页数据, 下一页游标, 是否还有更多)
    """
    limit = max(1, min(limit, current_app.config.get("MAX_PAGE_SIZE", 100)))

    payload = decode_cursor(cursor)
    if payload:
        clauses = []
        for index, (column, desc) in enumerate(sort_fields):
            prefix_clauses = []
            for prev_index in range(index):
                prev_col, prev_desc = sort_fields[prev_index]
                prev_value = payload.get(prev_col.key)
                if prev_value is None:
                    continue
                prefix_clauses.append(
                    prev_col == prev_value if not prev_desc else prev_col == prev_value
                )
            value = payload.get(column.key)
            if value is None:
                continue
            comparison = column < value if desc else column > value
            if prefix_clauses:
                clauses.append(and_(*prefix_clauses, comparison))
            else:
                clauses.append(comparison)
        if clauses:
            query = query.filter(or_(*clauses))

    for column, desc in sort_fields:
        query = query.order_by(column.desc() if desc else column.asc())

    rows = query.limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor({c.key: getattr(last, c.key) for c, _ in sort_fields})

    return rows, next_cursor, has_more
