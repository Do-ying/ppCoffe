"""统一响应包络。

成功：``{"ok": true, "data": {...}, "meta": {"requestId": "req_..."}}``
失败：``{"ok": false, "error": {...}, "meta": {"requestId": "req_..."}}``

契约见 docs/02-接口契约.md 第 1.2 节。前端 ``src/services/http.ts`` 只解包 ``data``，
错误则抛 ``ApiRequestError``（读 ``error.code`` / ``error.message`` / ``error.field``）。
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from flask import g, jsonify

from .ids import new_request_id

__all__ = ["ok", "fail", "request_id"]


def request_id() -> str:
    """当前请求的 requestId（与前端日志串联用）。"""
    rid = getattr(g, "request_id", None)
    if not rid:
        rid = new_request_id()
        g.request_id = rid
    return rid


def ok(
    data: Any = None,
    *,
    status: int = 200,
    meta: Optional[Dict[str, Any]] = None,
    pagination: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    """构造成功响应。"""
    body_meta: Dict[str, Any] = {"requestId": request_id()}
    if pagination:
        body_meta["pagination"] = pagination
    if meta:
        body_meta.update(meta)
    return jsonify({"ok": True, "data": data, "meta": body_meta}), status


def fail(
    code: str,
    message: str,
    *,
    status: int = 400,
    details: Optional[Dict[str, Any]] = None,
    field: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    """构造失败响应。"""
    error: Dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    if field is not None:
        error["field"] = field
    body_meta: Dict[str, Any] = {"requestId": request_id()}
    if meta:
        body_meta.update(meta)
    return jsonify({"ok": False, "error": error, "meta": body_meta}), status
