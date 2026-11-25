"""API 蓝图注册。"""

from __future__ import annotations

from datetime import datetime, timezone

from flask import Flask, current_app

from ..envelope import ok
from ..extensions import db
from . import auth_api, beans, brews, data, equipment, metadata, recipes, roasts, stats, uploads

__all__ = ["register_blueprints"]


def register_blueprints(app: Flask) -> None:
    """把所有 API 蓝图挂到 ``/api/v1`` 前缀下。"""
    prefix = app.config.get("API_PREFIX", "/api/v1")

    app.register_blueprint(auth_api.bp, url_prefix=f"{prefix}/auth")
    app.register_blueprint(metadata.bp, url_prefix=prefix)
    app.register_blueprint(beans.bp, url_prefix=f"{prefix}/beans")
    app.register_blueprint(brews.bp, url_prefix=f"{prefix}/brews")
    app.register_blueprint(roasts.bp, url_prefix=f"{prefix}/roasts")
    app.register_blueprint(recipes.bp, url_prefix=f"{prefix}/recipes")
    app.register_blueprint(equipment.bp, url_prefix=f"{prefix}/equipment")
    app.register_blueprint(stats.bp, url_prefix=f"{prefix}/stats")
    app.register_blueprint(uploads.bp, url_prefix=f"{prefix}/uploads")
    app.register_blueprint(data.bp, url_prefix=prefix)

    @app.get(f"{prefix}/health")
    def health():
        """健康检查：数据库 / 缓存 / 存储连通性。"""
        db_ok = True
        try:
            db.session.execute(db.text("SELECT 1"))
        except Exception:
            db_ok = False
            db.session.rollback()

        from ..extensions import redis_available

        return ok(
            {
                "status": "ok" if db_ok else "degraded",
                "database": "ok" if db_ok else "error",
                "redis": "ok" if redis_available() else "disabled",
                "storage": current_app.config.get("STORAGE_DRIVER", "local"),
                "authMode": current_app.config.get("AUTH_MODE", "dev"),
                "time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "version": "1.0.0",
            }
        )
