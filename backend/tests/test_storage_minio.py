"""MinIO 存储驱动的预签名行为测试。

重点覆盖一个容易踩的坑：SigV4 把 Host 计入签名，
所以「生成预签名 URL 的端点」必须与「客户端实际直传的地址」一致。
容器内网名（minio:9000）前端解析不了，必须用外网地址签名。
"""

from __future__ import annotations

import pytest
from flask import Flask


def _make_app(**overrides):
    app = Flask(__name__)
    app.config.update(
        STORAGE_DRIVER="minio",
        MINIO_ENDPOINT="minio:9000",
        MINIO_PUBLIC_ENDPOINT="",
        MINIO_ACCESS_KEY="testkey",
        MINIO_SECRET_KEY="testsecret",
        MINIO_SECURE=False,
        MINIO_PUBLIC_BASE_URL="",
        MINIO_BUCKET_BREW="ppcoffe-brew",
        MINIO_BUCKET_ROAST="ppcoffe-roast",
        MINIO_BUCKET_TEMP="ppcoffe-tmp",
        MINIO_URL_TTL=3600,
    )
    app.config.update(overrides)
    return app


def test_presign_uses_internal_endpoint_when_public_not_set():
    from app.services.storage import MinioStorage

    app = _make_app()
    with app.app_context():
        storage = MinioStorage()
        url = storage.presign_put("brew/br_1/a.jpg", "image/jpeg", 600)

    assert "minio:9000" in url
    assert "118.190.152.29" not in url


def test_presign_uses_public_endpoint_when_configured():
    """配置了外网端点后，签名 URL 必须指向外网地址。"""
    from app.services.storage import MinioStorage

    app = _make_app(MINIO_PUBLIC_ENDPOINT="118.190.152.29:9000")
    with app.app_context():
        storage = MinioStorage()
        url = storage.presign_put("brew/br_1/a.jpg", "image/jpeg", 600)

    assert "118.190.152.29:9000" in url
    assert "minio:9000" not in url
    # 签名参数必须齐全，否则 MinIO 会报 SignatureDoesNotMatch
    assert "X-Amz-Signature=" in url
    assert "X-Amz-Credential=" in url


def test_presign_get_uses_public_endpoint():
    from app.services.storage import MinioStorage

    app = _make_app(MINIO_PUBLIC_ENDPOINT="118.190.152.29:9000")
    with app.app_context():
        storage = MinioStorage()
        url = storage.presign_get("brew/br_1/a.jpg", 600)

    assert "118.190.152.29:9000" in url
    assert "X-Amz-Signature=" in url


def test_public_url_falls_back_to_presigned_get():
    """未配 CDN 公共域名时，访问地址退化为预签名 GET（私有桶 + 签名读）。"""
    from app.services.storage import MinioStorage

    app = _make_app(MINIO_PUBLIC_ENDPOINT="118.190.152.29:9000")
    with app.app_context():
        storage = MinioStorage()
        url = storage.public_url("brew/br_1/a.jpg")

    assert "118.190.152.29:9000" in url
    assert "X-Amz-Signature=" in url


def test_public_base_url_wins_over_presign():
    """配置了 CDN / 公共域名时，直接给稳定地址。"""
    from app.services.storage import MinioStorage

    app = _make_app(
        MINIO_PUBLIC_ENDPOINT="118.190.152.29:9000",
        MINIO_PUBLIC_BASE_URL="https://cdn.example.com",
    )
    with app.app_context():
        storage = MinioStorage()
        url = storage.public_url("brew/br_1/a.jpg")

    assert url == "https://cdn.example.com/ppcoffe-brew/brew/br_1/a.jpg"


def test_bucket_routing_by_prefix():
    from app.services.storage import MinioStorage

    app = _make_app()
    with app.app_context():
        storage = MinioStorage()
        assert storage.bucket_for("brew/x.jpg") == "ppcoffe-brew"
        assert storage.bucket_for("roast/x.alog") == "ppcoffe-roast"
        assert storage.bucket_for("tmp/x.part") == "ppcoffe-tmp"
        # 未知前缀回落到 brew
        assert storage.bucket_for("other/x.jpg") == "ppcoffe-brew"


def test_same_public_endpoint_does_not_create_second_client():
    """公网端点与内网端点相同时，不应重复建客户端。"""
    from app.services.storage import MinioStorage

    app = _make_app(MINIO_PUBLIC_ENDPOINT="minio:9000")
    with app.app_context():
        storage = MinioStorage()
        assert storage.presign_client is None
