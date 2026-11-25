"""统一错误码与异常。

契约见 docs/02-接口契约.md 第 1.3 节。

| code | HTTP | 含义 |
|---|---|---|
| INVALID_PARAM | 400 | 参数不合法 |
| VALIDATION_FAILED | 422 | 语义校验失败 |
| UNAUTHORIZED | 401 | 未登录 / token 失效 |
| FORBIDDEN | 403 | 无权访问该记录 |
| NOT_FOUND | 404 | 资源不存在 |
| CONFLICT | 409 | 重复资源 |
| RATE_LIMITED | 429 | 频率限制 |
| INTERNAL | 500 | 服务端异常 |
"""

from __future__ import annotations

from typing import Any, Dict, Optional

__all__ = [
    "ERROR_STATUS",
    "ApiError",
    "InvalidParam",
    "ValidationFailed",
    "Unauthorized",
    "Forbidden",
    "NotFound",
    "Conflict",
    "RateLimited",
    "InternalError",
]


class ApiError(Exception):
    """业务异常基类。"""

    code = "INTERNAL"
    status = 500
    message = "服务端异常"

    def __init__(
        self,
        message: Optional[str] = None,
        *,
        code: Optional[str] = None,
        status: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
        field: Optional[str] = None,
    ) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message
        if code:
            self.code = code
        if status:
            self.status = status
        self.details = details
        self.field = field

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        if self.field is not None:
            payload["field"] = self.field
        return payload


class InvalidParam(ApiError):
    code = "INVALID_PARAM"
    status = 400
    message = "参数不合法"


class ValidationFailed(ApiError):
    code = "VALIDATION_FAILED"
    status = 422
    message = "语义校验失败"


class Unauthorized(ApiError):
    code = "UNAUTHORIZED"
    status = 401
    message = "未登录或登录已失效"


class Forbidden(ApiError):
    code = "FORBIDDEN"
    status = 403
    message = "无权访问该资源"


class NotFound(ApiError):
    code = "NOT_FOUND"
    status = 404
    message = "资源不存在"


class Conflict(ApiError):
    code = "CONFLICT"
    status = 409
    message = "资源已存在"


class RateLimited(ApiError):
    code = "RATE_LIMITED"
    status = 429
    message = "请求过于频繁，请稍后再试"


class InternalError(ApiError):
    code = "INTERNAL"
    status = 500
    message = "服务端异常"


#: 错误码 → HTTP 状态码
ERROR_STATUS: Dict[str, int] = {
    "INVALID_PARAM": 400,
    "VALIDATION_FAILED": 422,
    "UNAUTHORIZED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "RATE_LIMITED": 429,
    "INTERNAL": 500,
}
