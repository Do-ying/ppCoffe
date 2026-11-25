"""ppCoffe 后端应用工厂。

启动：

    flask --app wsgi:app run --port 8000
    # 或
    python manage.py run
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from flask import Flask, g, jsonify, request

from .config import get_config
from .errors import ApiError
from .extensions import db, init_redis
from .ids import new_request_id

__all__ = ["create_app"]


def create_app(config_name: Optional[str] = None, **overrides: Any) -> Flask:
    """创建并配置 Flask 应用。"""
    app = Flask(__name__)
    config_class = get_config(config_name)
    app.config.from_object(config_class)
    if overrides:
        app.config.update(overrides)

    _configure_logging(app)
    # Flask 3.x 起 JSON_AS_ASCII 配置项已失效，需直接设置 provider
    # 让中文以原文输出（便于 curl / 浏览器直接查看；JSON 语义不受影响）
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    # Flask-SQLAlchemy 读取 SQLALCHEMY_DATABASE_URI
    app.config.setdefault("SQLALCHEMY_DATABASE_URI", app.config["DATABASE_URL"])
    app.config.setdefault(
        "SQLALCHEMY_ENGINE_OPTIONS",
        {
            "pool_pre_ping": True,
            "pool_recycle": app.config.get("SQLALCHEMY_POOL_RECYCLE", 280),
        },
    )
    db.init_app(app)
    init_redis(app)

    @app.before_request
    def _assign_request_id() -> None:
        g.request_id = request.headers.get("X-Request-Id") or new_request_id()

    @app.after_request
    def _echo_request_id(response):
        response.headers.setdefault("X-Request-Id", getattr(g, "request_id", ""))
        return response

    _register_cors(app)

    _register_error_handlers(app)

    # 延迟导入，避免循环依赖
    from .api import register_blueprints

    register_blueprints(app)

    _register_openapi(app)

    return app


def _register_openapi(app: Flask) -> None:
    """把 OpenAPI 3.1 文档挂到 ``/api/v1/openapi.json``。"""

    @app.get(f"{app.config.get('API_PREFIX', '/api/v1')}/openapi.json")
    def openapi_json():
        from .openapi import build_spec

        return jsonify(build_spec())


def _configure_logging(app: Flask) -> None:
    level = logging.DEBUG if app.config.get("DEBUG") else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    app.logger.setLevel(level)


def _register_cors(app: Flask) -> None:
    """跨域支持。

    小程序自身的网络层不受 CORS 约束，但 **H5 版在浏览器里跑会被跨域拦**，
    所以这里按 ``CORS_ORIGINS`` 配置放行（H5 联调 / 自建前端页面都需要）。

    ``CORS_ORIGINS=*`` 时回显请求来源（而不是写死 ``*``），
    这样带 Authorization 头的请求才能通过预检。
    """

    allowed = app.config.get("CORS_ORIGINS") or []
    if isinstance(allowed, str):
        allowed = [item.strip() for item in allowed.split(",") if item.strip()]

    @app.after_request
    def _apply_cors(response):
        origin = request.headers.get("Origin")
        if not origin or not allowed:
            return response

        if "*" in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        elif origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        else:
            return response

        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = (
            "Authorization, Content-Type, X-Request-Id"
        )
        response.headers["Access-Control-Expose-Headers"] = "X-Request-Id"
        response.headers["Access-Control-Max-Age"] = "600"
        return response


def _register_error_handlers(app: Flask) -> None:
    """把异常统一转成契约里的错误包络。"""

    @app.errorhandler(ApiError)
    def _handle_api_error(exc: ApiError):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": exc.to_payload(),
                    "meta": {"requestId": getattr(g, "request_id", "")},
                }
            ),
            exc.status,
        )

    @app.errorhandler(404)
    def _handle_404(_exc):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": {"code": "NOT_FOUND", "message": "接口不存在"},
                    "meta": {"requestId": getattr(g, "request_id", "")},
                }
            ),
            404,
        )

    @app.errorhandler(405)
    def _handle_405(_exc):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": {"code": "INVALID_PARAM", "message": "请求方法不被允许"},
                    "meta": {"requestId": getattr(g, "request_id", "")},
                }
            ),
            405,
        )

    @app.errorhandler(Exception)
    def _handle_unexpected(exc: Exception):
        app.logger.exception("未处理异常: %s", exc)
        return (
            jsonify(
                {
                    "ok": False,
                    "error": {"code": "INTERNAL", "message": "服务端异常"},
                    "meta": {"requestId": getattr(g, "request_id", "")},
                }
            ),
            500,
        )
