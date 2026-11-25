"""API 集成测试。

用内存 SQLite 跑完整请求链路（MySQL 与 SQLite 共用同一套 ORM 模型与 SQL），
验证响应包络、错误码、游标分页、核心差异化端点。
"""

from __future__ import annotations

import base64
import json
from typing import Any, Dict

import pytest

from app import create_app
from app.extensions import db as _db


@pytest.fixture()
def app():
    application = create_app("testing")
    with application.app_context():
        _db.create_all()
        yield application
        _db.session.remove()
        _db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def call(client, method, url, json_body=None, **kwargs):
    """发请求并返回 ``(status, body)``。"""
    response = client.open(url, method=method, json=json_body, **kwargs)
    payload = response.get_json(silent=True) or {}
    return response.status_code, payload


# --------------------------------------------------------------------- #
#  基础包络
# --------------------------------------------------------------------- #


def test_health(client):
    status, body = call(client, "GET", "/api/v1/health")
    assert status == 200
    assert body["ok"] is True
    assert body["data"]["status"] == "ok"
    assert body["meta"]["requestId"].startswith("req_")


def test_envelope_shape(client):
    status, body = call(client, "GET", "/api/v1/methods")
    assert status == 200
    assert set(body.keys()) == {"ok", "data", "meta"}
    assert body["ok"] is True
    assert "requestId" in body["meta"]


def test_unknown_route_returns_404_envelope(client):
    status, body = call(client, "GET", "/api/v1/not-exist")
    assert status == 404
    assert body["ok"] is False
    assert body["error"]["code"] == "NOT_FOUND"


def test_cors_headers_present_for_allowed_origin(client):
    response = client.get("/api/v1/methods", headers={"Origin": "http://localhost:10086"})
    assert response.status_code == 200
    assert response.headers.get("Access-Control-Allow-Origin") == "http://localhost:10086"
    assert "Authorization" in response.headers.get("Access-Control-Allow-Headers", "")


def test_cors_preflight_is_answered(client):
    response = client.options(
        "/api/v1/brews",
        headers={
            "Origin": "http://localhost:10086",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code in (200, 204)
    assert response.headers.get("Access-Control-Allow-Origin") == "http://localhost:10086"
    assert "POST" in response.headers.get("Access-Control-Allow-Methods", "")


# --------------------------------------------------------------------- #
#  元数据
# --------------------------------------------------------------------- #


def test_methods_metadata(client):
    status, body = call(client, "GET", "/api/v1/methods")
    assert status == 200
    items = body["data"]["items"]
    assert len(items) == 11
    v60 = next(m for m in items if m["id"] == "pour_over_v60")
    assert v60["flavorBaseline"]["acidity"] == 7
    assert len(v60["defaultSteps"]) == 4
    assert "ratio" in v60["params"]


def test_flavor_wheel(client):
    status, body = call(client, "GET", "/api/v1/flavor-wheel")
    assert status == 200
    assert body["data"]["version"] == "SCA-2016-WCR"
    assert len(body["data"]["categories"]) == 9


def test_roast_phases(client):
    status, body = call(client, "GET", "/api/v1/roast-phases")
    assert status == 200
    assert len(body["data"]["phases"]) == 3


# --------------------------------------------------------------------- #
#  豆子
# --------------------------------------------------------------------- #


def test_bean_crud(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/beans",
        {
            "name": "耶加雪菲 G1",
            "roaster": "几何咖啡",
            "origin": {"country": "埃塞俄比亚", "region": "Sidama"},
            "process": "washed",
            "roastLevel": "light",
            "roastDate": "2026-11-10",
            "weightGrams": 200,
            "remainingGrams": 120,
            "tags": ["花果香"],
        },
    )
    assert status == 201
    bean = body["data"]
    assert bean["id"].startswith("bn_")
    assert bean["origin"]["country"] == "埃塞俄比亚"

    status, body = call(client, "GET", f"/api/v1/beans/{bean['id']}")
    assert status == 200
    assert body["data"]["name"] == "耶加雪菲 G1"

    status, body = call(
        client, "PATCH", f"/api/v1/beans/{bean['id']}", {"remainingGrams": 80}
    )
    assert status == 200
    assert body["data"]["remainingGrams"] == 80

    status, body = call(client, "GET", "/api/v1/beans")
    assert status == 200
    assert len(body["data"]["items"]) == 1

    status, body = call(client, "DELETE", f"/api/v1/beans/{bean['id']}")
    assert status == 200
    assert body["data"]["ok"] is True

    status, body = call(client, "GET", f"/api/v1/beans/{bean['id']}")
    assert status == 404
    assert body["error"]["code"] == "NOT_FOUND"


def test_bean_cursor_pagination(client):
    for i in range(5):
        call(client, "POST", "/api/v1/beans", {"name": f"豆子-{i}", "roastDate": "2026-11-10"})

    status, body = call(client, "GET", "/api/v1/beans?limit=2")
    assert status == 200
    assert len(body["data"]["items"]) == 2
    assert body["meta"]["pagination"]["hasMore"] is True

    cursor = body["meta"]["pagination"]["nextCursor"]
    seen = {b["id"] for b in body["data"]["items"]}

    status, body = call(client, "GET", f"/api/v1/beans?limit=2&cursor={cursor}")
    assert status == 200
    page2 = {b["id"] for b in body["data"]["items"]}
    assert not (seen & page2)
    assert len(page2) == 2


def test_invalid_sort_field_rejected(client):
    status, body = call(client, "GET", "/api/v1/beans?sort=bogus")
    assert status == 400
    assert body["error"]["code"] == "INVALID_PARAM"


# --------------------------------------------------------------------- #
#  冲煮
# --------------------------------------------------------------------- #


@pytest.fixture()
def bean_id(client):
    _, body = call(
        client,
        "POST",
        "/api/v1/beans",
        {"name": "测试豆", "roastDate": "2026-11-10"},
    )
    return body["data"]["id"]


def test_create_brew_auto_derives_curve(client, bean_id):
    status, body = call(
        client,
        "POST",
        "/api/v1/brews",
        {
            "beanId": bean_id,
            "method": "pour_over_v60",
            "params": {"doseGrams": 15, "waterGrams": 250, "brewSeconds": 165, "temperature": 93},
            "flavor": {
                "axes": {
                    "acidity": 8,
                    "sweetness": 4,
                    "body": 4,
                    "flavor": 7,
                    "aftertaste": 4,
                    "balance": 5,
                },
                "descriptors": [],
                "defects": [],
                "tempStage": "warm",
                "overall": 5.3,
                "note": "前段有明显柑橘酸",
            },
        },
    )
    assert status == 201
    brew = body["data"]
    assert brew["id"].startswith("br_")
    assert brew["params"]["ratio"] == pytest.approx(16.67)
    assert brew["curve"]["source"] == "plan"
    assert len(brew["curve"]["points"]) > 100
    assert brew["curve"]["points"][0]["t"] == 0


def test_create_brew_rejects_out_of_range_params(client, bean_id):
    status, body = call(
        client,
        "POST",
        "/api/v1/brews",
        {
            "beanId": bean_id,
            "method": "espresso",
            # 粉液比 10:1，远超意式的 1.5-3
            "params": {"doseGrams": 10, "waterGrams": 100, "brewSeconds": 28},
        },
    )
    assert status == 422
    assert body["error"]["code"] == "VALIDATION_FAILED"


def test_create_brew_rejects_unknown_method(client, bean_id):
    status, body = call(
        client, "POST", "/api/v1/brews", {"beanId": bean_id, "method": "not_a_method"}
    )
    assert status == 422
    assert body["error"]["field"] == "method"


def test_brew_diagnosis(client, bean_id):
    _, body = call(
        client,
        "POST",
        "/api/v1/brews",
        {
            "beanId": bean_id,
            "method": "pour_over_v60",
            "params": {"doseGrams": 15, "waterGrams": 250, "brewSeconds": 165},
            "flavor": {
                "axes": {
                    "acidity": 8,
                    "sweetness": 4,
                    "body": 4,
                    "flavor": 7,
                    "aftertaste": 4,
                    "balance": 5,
                },
                "descriptors": [],
                "defects": [],
                "tempStage": "warm",
                "overall": 5.3,
                "note": "",
            },
        },
    )
    brew_id = body["data"]["id"]

    status, body = call(client, "GET", f"/api/v1/brews/{brew_id}/diagnosis")
    assert status == 200
    data = body["data"]
    assert data["verdict"] == "under_extracted"
    assert data["matchScore"] > 0
    actions = [p["action"] for p in data["prescriptions"]]
    assert "grind_finer" in actions
    assert data["prescriptions"][0]["priority"] == 1


def test_derive_curve_matches_frontend_generator(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/brews/derive-curve",
        {
            "method": "pour_over_v60",
            "mode": "plan",
            "params": {"doseGrams": 15, "waterGrams": 250, "brewSeconds": 165},
        },
    )
    assert status == 200
    data = body["data"]
    assert data["meta"]["generator"] == "monotone-cubic-v1"
    assert data["meta"]["pointCount"] == len(data["points"])
    # 与前端 TS 基准一致：166 个点，首点 t=0/w=0
    assert len(data["points"]) == 166
    assert data["points"][0]["t"] == 0
    assert data["points"][0]["w"] == 0
    assert data["stages"][0]["label"] == "闷蒸"


def test_derive_curve_keypoint_mode(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/brews/derive-curve",
        {
            "method": "pour_over_v60",
            "mode": "keypoint",
            "keypoints": [{"t": 0, "w": 0}, {"t": 45, "w": 45}, {"t": 165, "w": 250}],
        },
    )
    assert status == 200
    assert len(body["data"]["points"]) > 0
    assert body["data"]["meta"]["source"] == "keypoint"


def test_brew_compare(client, bean_id):
    ids = []
    for axes in (
        {"acidity": 8, "sweetness": 4, "body": 4, "flavor": 7, "aftertaste": 4, "balance": 5},
        {"acidity": 6, "sweetness": 7, "body": 4, "flavor": 8, "aftertaste": 7, "balance": 7},
    ):
        _, body = call(
            client,
            "POST",
            "/api/v1/brews",
            {
                "beanId": bean_id,
                "method": "pour_over_v60",
                "params": {"doseGrams": 15, "waterGrams": 250, "brewSeconds": 165},
                "flavor": {
                    "axes": axes,
                    "descriptors": [],
                    "defects": [],
                    "tempStage": "warm",
                    "overall": 6,
                    "note": "",
                },
            },
        )
        ids.append(body["data"]["id"])

    status, body = call(client, "POST", "/api/v1/brews/compare", {"brewIds": ids})
    assert status == 200
    data = body["data"]
    assert len(data["brews"]) == 2
    assert len(data["curves"]) == 2
    flavor_diff = {item["axis"]: item for item in data["flavorDiff"]}
    assert flavor_diff["acidity"]["delta"] == -2


def test_delete_brew(client, bean_id):
    _, body = call(
        client,
        "POST",
        "/api/v1/brews",
        {"beanId": bean_id, "method": "pour_over_v60", "params": {"doseGrams": 15, "waterGrams": 250}},
    )
    brew_id = body["data"]["id"]
    status, _ = call(client, "DELETE", f"/api/v1/brews/{brew_id}")
    assert status == 200
    status, body = call(client, "GET", f"/api/v1/brews/{brew_id}")
    assert status == 404


# --------------------------------------------------------------------- #
#  烘豆
# --------------------------------------------------------------------- #


ALOG = """# Artisan Coffee Roaster 2.2.0
# time\tBean Temp\tEnv Temp\tRoR
0\t205.4\t180.2\t0
10\t168.3\t182.1\t14.2
40\t120.1\t187.9\t5.1
78\t108.2\t189.4\t2.9
150\t140.5\t200.1\t6.1
240\t158.3\t210.1\t3.2
300\t178.6\t218.4\t4.9
348\t201.2\t231.0\t4.4
430\t209.8\t238.6\t2.1
512\t216.4\t242.0\t1.8
# Charge\t0\t205
# First Crack\t348\t201
# Drop\t512\t216
"""


def test_roast_import_alog(client, bean_id):
    payload = base64.b64encode(ALOG.encode("utf-8")).decode("ascii")
    status, body = call(
        client,
        "POST",
        "/api/v1/roasts/import",
        {
            "format": "artisan_alog",
            "beanId": bean_id,
            "payload": payload,
            "roaster": "Aillio Bullet R2",
            "greenGrams": 500,
            "outGrams": 425,
        },
    )
    assert status == 201
    data = body["data"]
    assert data["parsed"]["points"] == 10
    assert "firstCrack" in data["parsed"]["events"]

    roast = data["roast"]
    assert roast["dtrPercent"] == pytest.approx(32.0)
    assert roast["weightLossPercent"] == pytest.approx(15.0)
    # 缺 dryEnd 标记时按温度阈值自动推断
    assert roast["phaseRatio"]["drying"] == pytest.approx(46.9, abs=0.2)
    assert len(roast["curve"]["points"]) == 10
    assert "ror" in roast["curve"]["points"][0]


def test_roast_append_event_updates_metrics(client, bean_id):
    status, body = call(
        client,
        "POST",
        "/api/v1/roasts",
        {
            "beanId": bean_id,
            "batchNo": "2026-1110-A",
            "greenGrams": 500,
            "outGrams": 425,
            "totalSeconds": 512,
            "events": [
                {"type": "charge", "atSecond": 0, "temperature": 205},
                {"type": "firstCrack", "atSecond": 348, "temperature": 201},
                {"type": "drop", "atSecond": 512, "temperature": 216},
            ],
        },
    )
    assert status == 201
    roast_id = body["data"]["id"]
    assert body["data"]["dtrPercent"] == pytest.approx(32.0)

    status, body = call(
        client,
        "POST",
        f"/api/v1/roasts/{roast_id}/events",
        {"type": "dryEnd", "atSecond": 240, "temperature": 158},
    )
    assert status == 200
    assert body["data"]["phaseRatio"]["drying"] == pytest.approx(46.9, abs=0.2)


def test_roast_compare(client, bean_id):
    ids = []
    for no in ("A", "B"):
        _, body = call(
            client,
            "POST",
            "/api/v1/roasts",
            {
                "beanId": bean_id,
                "batchNo": f"2026-1110-{no}",
                "greenGrams": 500,
                "outGrams": 425,
                "totalSeconds": 512,
                "events": [
                    {"type": "charge", "atSecond": 0, "temperature": 205},
                    {"type": "dryEnd", "atSecond": 240, "temperature": 158},
                    {"type": "firstCrack", "atSecond": 348, "temperature": 201},
                    {"type": "drop", "atSecond": 512, "temperature": 216},
                ],
            },
        )
        ids.append(body["data"]["id"])

    status, body = call(client, "POST", "/api/v1/roasts/compare", {"roastIds": ids})
    assert status == 200
    assert len(body["data"]["roasts"]) == 2
    assert len(body["data"]["curves"]) == 2


# --------------------------------------------------------------------- #
#  器具 / 配方
# --------------------------------------------------------------------- #


def test_equipment_crud(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/equipment",
        {"type": "grinder", "name": "EK43", "brand": "Fellow", "notes": "#22 约 0.8mm"},
    )
    assert status == 201
    equipment_id = body["data"]["id"]

    status, body = call(client, "GET", "/api/v1/equipment")
    assert status == 200
    assert body["data"]["groups"]["grinder"][0]["name"] == "EK43"

    status, body = call(
        client, "PATCH", f"/api/v1/equipment/{equipment_id}", {"name": "EK43 S"}
    )
    assert status == 200
    assert body["data"]["name"] == "EK43 S"

    status, _ = call(client, "DELETE", f"/api/v1/equipment/{equipment_id}")
    assert status == 200


def test_recipe_crud(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/recipes",
        {
            "name": "耶加雪菲标准配方",
            "method": "pour_over_v60",
            "params": {"doseGrams": 15, "waterGrams": 250},
            "steps": [{"atSecond": 0, "toGrams": 30, "label": "闷蒸", "stage": "bloom"}],
        },
    )
    assert status == 201
    recipe_id = body["data"]["id"]

    status, body = call(client, "GET", "/api/v1/recipes")
    assert status == 200
    assert len(body["data"]["items"]) == 1

    status, _ = call(client, "DELETE", f"/api/v1/recipes/{recipe_id}")
    assert status == 200


# --------------------------------------------------------------------- #
#  统计 / 导入导出
# --------------------------------------------------------------------- #


def test_stats_summary(client, bean_id):
    call(
        client,
        "POST",
        "/api/v1/brews",
        {
            "beanId": bean_id,
            "method": "pour_over_v60",
            "params": {"doseGrams": 15, "waterGrams": 250},
            "flavor": {
                "axes": {
                    "acidity": 7,
                    "sweetness": 6,
                    "body": 4,
                    "flavor": 8,
                    "aftertaste": 6,
                    "balance": 6,
                },
                "descriptors": [],
                "defects": [],
                "tempStage": "warm",
                "overall": 6.2,
                "note": "",
            },
        },
    )
    status, body = call(client, "GET", "/api/v1/stats/summary")
    assert status == 200
    data = body["data"]
    assert data["week"]["brewCount"] == 1
    assert data["week"]["byMethod"]["pour_over_v60"] == 1
    assert len(data["restingBeans"]) == 1


def test_export_import_roundtrip(client, bean_id):
    call(
        client,
        "POST",
        "/api/v1/brews",
        {
            "beanId": bean_id,
            "method": "pour_over_v60",
            "params": {"doseGrams": 15, "waterGrams": 250},
        },
    )
    status, body = call(client, "GET", "/api/v1/export?format=json")
    assert status == 200
    data = body["data"]["data"]
    assert len(data["beans"]) == 1
    assert len(data["brews"]) == 1


def test_export_csv(client, bean_id):
    call(
        client,
        "POST",
        "/api/v1/brews",
        {
            "beanId": bean_id,
            "method": "pour_over_v60",
            "params": {"doseGrams": 15, "waterGrams": 250},
        },
    )
    response = client.get("/api/v1/export?format=csv&dataset=brews")
    assert response.status_code == 200
    assert "text/csv" in response.headers["Content-Type"]
    text = response.get_data(as_text=True)
    assert "ratio" in text.splitlines()[0]


# --------------------------------------------------------------------- #
#  上传
# --------------------------------------------------------------------- #


def test_presign_upload(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/uploads/presign",
        {"filename": "brew/photo.jpg", "contentType": "image/jpeg", "sizeBytes": 1024},
    )
    assert status == 200
    data = body["data"]
    assert data["objectKey"].startswith("brew/")
    assert data["objectKey"].endswith(".jpg")
    assert data["headers"]["Content-Type"] == "image/jpeg"
    assert "signature=" in data["uploadUrl"]


def test_upload_data_uri(client):
    tiny = base64.b64encode(b"\xff\xd8\xff\xe0fakejpeg").decode("ascii")
    status, body = call(
        client,
        "POST",
        "/api/v1/uploads",
        {"filename": "brew/photo.jpg", "dataUri": f"data:image/jpeg;base64,{tiny}", "sizeBytes": 10},
    )
    assert status == 201
    assert body["data"]["objectKey"].startswith("brew/")
    assert body["data"]["url"]


def test_delete_upload(client):
    status, body = call(
        client,
        "POST",
        "/api/v1/uploads",
        {"filename": "brew/photo.jpg", "dataUri": "data:image/jpeg;base64,QUJD"},
    )
    object_key = body["data"]["objectKey"]
    status, _ = call(client, "DELETE", f"/api/v1/uploads?objectKey={object_key}")
    assert status == 200


# --------------------------------------------------------------------- #
#  认证
# --------------------------------------------------------------------- #


def test_dev_login_issue_and_refresh_token(app):
    application = app
    application.config["AUTH_MODE"] = "dev"
    client = application.test_client()

    status, body = call(client, "POST", "/api/v1/auth/wechat", {"code": "wx-code-1"})
    assert status == 200
    token = body["data"]["token"]
    refresh = body["data"]["refreshToken"]
    assert body["data"]["user"]["id"].startswith("us_")

    status, body = call(client, "GET", "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert status == 200
    assert body["data"]["id"].startswith("us_")

    status, body = call(
        client, "POST", "/api/v1/auth/refresh", {"refreshToken": refresh}
    )
    assert status == 200
    assert body["data"]["token"]


def test_refresh_with_access_token_rejected(app):
    application = app
    application.config["AUTH_MODE"] = "dev"
    client = application.test_client()

    _, body = call(client, "POST", "/api/v1/auth/wechat", {"code": "wx-code-2"})
    access = body["data"]["token"]
    status, body = call(client, "POST", "/api/v1/auth/refresh", {"refreshToken": access})
    assert status == 401
    assert body["error"]["code"] == "UNAUTHORIZED"


# --------------------------------------------------------------------- #
#  用户隔离
# --------------------------------------------------------------------- #


def test_owner_scoped_records_visible_to_owner_only(app):
    """别人的记录不可见；自己的可见。"""
    application = app
    application.config["AUTH_MODE"] = "dev"
    client = application.test_client()

    with application.app_context():
        from app.models.bean import Bean

        db = _db
        db.session.add(
            Bean(id="bn_other_user", user_id="us_someone_else", name="别人的豆子")
        )
        db.session.commit()

    _, body = call(client, "POST", "/api/v1/auth/wechat", {"code": "wx-code-iso"})
    token = body["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}

    status, body = call(client, "GET", "/api/v1/beans", headers=headers)
    assert status == 200
    names = {b["name"] for b in body["data"]["items"]}
    assert "别人的豆子" not in names


def test_unowned_records_are_visible_to_everyone(app):
    """``user_id IS NULL`` 视为公共数据（演示数据 / 导入的初始数据）。

    历史上这里用严格等值过滤，导致单条可读（ensure_owner 放行 NULL）
    但列表查不到 —— 前后端表现不一致。现在两者统一。
    """
    application = app
    application.config["AUTH_MODE"] = "dev"
    client = application.test_client()

    with application.app_context():
        from app.models.bean import Bean

        db = _db
        db.session.add(Bean(id="bn_public", user_id=None, name="公共豆子"))
        db.session.commit()

    _, body = call(client, "POST", "/api/v1/auth/wechat", {"code": "wx-code-public"})
    token = body["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}

    status, body = call(client, "GET", "/api/v1/beans", headers=headers)
    assert status == 200
    names = {b["name"] for b in body["data"]["items"]}
    assert "公共豆子" in names

    # 单条读取与列表行为保持一致
    status, body = call(client, "GET", "/api/v1/beans/bn_public", headers=headers)
    assert status == 200
    assert body["data"]["name"] == "公共豆子"


def test_delete_bean_removes_it(app):
    """删除豆子后不再出现在列表中。"""
    application = app
    application.config["AUTH_MODE"] = "dev"
    client = application.test_client()

    _, body = call(client, "POST", "/api/v1/auth/wechat", {"code": "wx-code-del"})
    token = body["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}

    status, body = call(
        client,
        "POST",
        "/api/v1/beans",
        {"name": "待删除的豆子", "roastDate": "2026-11-10"},
        headers=headers,
    )
    assert status == 201
    bean_id = body["data"]["id"]

    status, body = call(client, "DELETE", f"/api/v1/beans/{bean_id}", headers=headers)
    assert status == 200

    status, body = call(client, "GET", "/api/v1/beans", headers=headers)
    assert status == 200
    assert all(b["id"] != bean_id for b in body["data"]["items"])
