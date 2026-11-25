"""应用配置

配置来源优先级：环境变量 > ``backend/.env`` > 默认值。

生产环境请用环境变量注入敏感信息（数据库密码、JWT 密钥、MinIO 密钥），
``.env`` 仅用于本地开发，且不应提交到仓库。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _list(value: str | None, default: List[str] = None) -> List[str]:  # type: ignore[assignment]
    if not value:
        return list(default or [])
    return [item.strip() for item in value.split(",") if item.strip()]


class BaseConfig:
    """基础配置。"""

    # ---- 应用 ----
    APP_NAME = "ppCoffe API"
    API_PREFIX = "/api/v1"
    DEBUG = False
    TESTING = False
    JSON_AS_ASCII = False
    JSON_SORT_KEYS = False

    # ---- 鉴权 ----
    # 生产环境务必覆盖（HMAC-SHA256 建议 ≥ 32 字节）
    SECRET_KEY = os.getenv(
        "SECRET_KEY", "ppcoffe-dev-secret-change-me-0123456789abcdef"
    )
    JWT_SECRET = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM = "HS256"
    #: access token 有效期（秒），默认 7 天
    JWT_ACCESS_TTL = int(os.getenv("JWT_ACCESS_TTL", str(7 * 24 * 3600)))
    #: refresh token 有效期（秒），默认 30 天
    JWT_REFRESH_TTL = int(os.getenv("JWT_REFRESH_TTL", str(30 * 24 * 3600)))
    #: 鉴权模式：wechat（微信小程序）/ dev（开发登录）/ none（本地单机，无鉴权）
    AUTH_MODE = os.getenv("AUTH_MODE", "dev")
    WECHAT_APPID = os.getenv("WECHAT_APPID", "")
    WECHAT_SECRET = os.getenv("WECHAT_SECRET", "")
    WECHAT_API_BASE = os.getenv("WECHAT_API_BASE", "https://api.weixin.qq.com")

    # ---- 数据库 ----
    #: 默认 MySQL 8；本地无 MySQL 时可切到 sqlite:///./var/ppcoffe.db
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://ppcoffe:ppcoffe@127.0.0.1:3306/ppcoffe?charset=utf8mb4",
    )
    SQLALCHEMY_ECHO = _bool(os.getenv("SQLALCHEMY_ECHO"), False)
    SQLALCHEMY_POOL_SIZE = int(os.getenv("SQLALCHEMY_POOL_SIZE", "10"))
    SQLALCHEMY_POOL_RECYCLE = int(os.getenv("SQLALCHEMY_POOL_RECYCLE", "280"))

    # ---- Redis（可选，未配置时自动降级为无缓存）----
    REDIS_URL = os.getenv("REDIS_URL", "")
    REDIS_NAMESPACE = os.getenv("REDIS_NAMESPACE", "ppcoffe")
    #: 元数据缓存 TTL（秒）
    CACHE_TTL_METADATA = int(os.getenv("CACHE_TTL_METADATA", "3600"))
    #: 统计缓存 TTL（秒）
    CACHE_TTL_STATS = int(os.getenv("CACHE_TTL_STATS", "60"))

    # ---- 对象存储 ----
    #: minio | local（本地文件系统兜底，便于无 MinIO 时联调）
    STORAGE_DRIVER = os.getenv("STORAGE_DRIVER", "local")
    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
    #: 预签名专用端点（前端可达的 host:port）。
    #: SigV4 把 Host 计入签名，签名端点必须与客户端实际访问的地址一致，
    #: 否则直传会报 SignatureDoesNotMatch。留空则复用 MINIO_ENDPOINT。
    MINIO_PUBLIC_ENDPOINT = os.getenv("MINIO_PUBLIC_ENDPOINT", "")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_SECURE = _bool(os.getenv("MINIO_SECURE"), False)
    #: 存储区域。显式指定可避免 SDK 在预签名时联网查 GetBucketLocation。
    MINIO_REGION = os.getenv("MINIO_REGION", "us-east-1")
    #: 公共访问前缀（CDN 或反代域名），为空则用 endpoint + bucket 拼装
    MINIO_PUBLIC_BASE_URL = os.getenv("MINIO_PUBLIC_BASE_URL", "")
    MINIO_BUCKET_BREW = os.getenv("MINIO_BUCKET_BREW", "ppcoffe-brew")
    MINIO_BUCKET_ROAST = os.getenv("MINIO_BUCKET_ROAST", "ppcoffe-roast")
    MINIO_BUCKET_TEMP = os.getenv("MINIO_BUCKET_TEMP", "ppcoffe-tmp")
    #: 本地存储兜底目录
    LOCAL_STORAGE_ROOT = os.getenv("LOCAL_STORAGE_ROOT", str(BASE_DIR / "var" / "uploads"))

    # ---- 其它 ----
    #: 对外可访问的基地址（预签名直传地址需要拼绝对 URL）
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")
    CORS_ORIGINS = _list(os.getenv("CORS_ORIGINS"), ["*"])
    #: 导出接口单次最大记录数
    EXPORT_MAX_ROWS = int(os.getenv("EXPORT_MAX_ROWS", "50000"))
    #: 列表接口默认分页大小
    DEFAULT_PAGE_SIZE = int(os.getenv("DEFAULT_PAGE_SIZE", "20"))
    MAX_PAGE_SIZE = int(os.getenv("MAX_PAGE_SIZE", "100"))

    @classmethod
    def as_dict(cls) -> Dict[str, Any]:
        return {
            key: getattr(cls, key)
            for key in dir(cls)
            if key.isupper() and not key.startswith("_")
        }


class DevelopmentConfig(BaseConfig):
    DEBUG = True


class TestingConfig(BaseConfig):
    TESTING = True
    AUTH_MODE = "none"
    DATABASE_URL = os.getenv("TEST_DATABASE_URL", "sqlite://")
    STORAGE_DRIVER = "local"
    REDIS_URL = ""


class ProductionConfig(BaseConfig):
    DEBUG = False


def get_config(name: str | None = None) -> type[BaseConfig]:
    """按名称返回配置类。"""
    key = (name or os.getenv("APP_ENV", "development")).lower()
    return {
        "development": DevelopmentConfig,
        "testing": TestingConfig,
        "production": ProductionConfig,
    }.get(key, DevelopmentConfig)
