"""OpenAPI 3.1 文档生成。

契约里建议「后端直接产出 OpenAPI 3.1 文档，前端用 openapi-typescript 生成类型，杜绝契约漂移」。

    python manage.py export-openapi   # → backend/openapi.json
    GET /api/v1/openapi.json          # 运行时也可获取
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

__all__ = ["build_spec"]


# --------------------------------------------------------------------- #
#  组件 schema
# --------------------------------------------------------------------- #


def _obj(properties: Dict[str, Any], required: Optional[List[str]] = None, **extra: Any) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        **({"required": required} if required else {}),
        **extra,
    }


def _ref(name: str) -> Dict[str, Any]:
    return {"$ref": f"#/components/schemas/{name}"}


def _arr(items: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "array", "items": items}


def _str(**kw: Any) -> Dict[str, Any]:
    return {"type": "string", **kw}


def _num(**kw: Any) -> Dict[str, Any]:
    return {"type": "number", **kw}


def _int(**kw: Any) -> Dict[str, Any]:
    return {"type": "integer", **kw}


def _bool(**kw: Any) -> Dict[str, Any]:
    return {"type": "boolean", **kw}


SCHEMAS: Dict[str, Any] = {
    "Meta": _obj(
        {
            "requestId": _str(description="请求追踪 ID"),
            "pagination": _obj(
                {
                    "nextCursor": _str(nullable=True),
                    "hasMore": _bool(),
                    "limit": _int(),
                }
            ),
        }
    ),
    "Error": _obj(
        {
            "code": _str(enum=["INVALID_PARAM", "VALIDATION_FAILED", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL"]),
            "message": _str(),
            "details": {"type": "object", "additionalProperties": True},
            "field": _str(nullable=True),
        },
        ["code", "message"],
    ),
    "ErrorEnvelope": _obj(
        {
            "ok": {"const": False},
            "error": _ref("Error"),
            "meta": _ref("Meta"),
        },
        ["ok", "error"],
    ),
    "Origin": _obj(
        {
            "country": _str(nullable=True),
            "region": _str(nullable=True),
            "farm": _str(nullable=True),
            "altitudeMasl": _int(nullable=True),
            "variety": _str(nullable=True),
        }
    ),
    "Bean": _obj(
        {
            "id": _str(),
            "name": _str(),
            "roaster": _str(),
            "origin": _ref("Origin"),
            "process": _str(enum=["washed", "natural", "honey", "anaerobic", "other"]),
            "roastLevel": _str(enum=["light", "medium", "medium_dark", "dark"]),
            "agtron": _int(nullable=True),
            "roastDate": _str(format="date", nullable=True),
            "weightGrams": _int(),
            "remainingGrams": _int(),
            "tags": _arr(_str()),
            "imageUrl": _str(nullable=True),
            "notes": _str(),
            "createdAt": _str(format="date-time"),
            "updatedAt": _str(format="date-time"),
        },
        ["id", "name", "createdAt", "updatedAt"],
    ),
    "FlavorAxes": _obj(
        {
            "acidity": _int(minimum=0, maximum=10),
            "sweetness": _int(minimum=0, maximum=10),
            "body": _int(minimum=0, maximum=10),
            "flavor": _int(minimum=0, maximum=10),
            "aftertaste": _int(minimum=0, maximum=10),
            "balance": _int(minimum=0, maximum=10),
        },
        ["acidity", "sweetness", "body", "flavor", "aftertaste", "balance"],
    ),
    "FlavorDescriptor": _obj(
        {
            "id": _str(),
            "label": _str(nullable=True),
            "category": _str(nullable=True),
            "intensity": _int(minimum=0, maximum=10),
            "tempStage": _str(enum=["hot", "warm", "cool"]),
        }
    ),
    "FlavorDefect": _obj(
        {"id": _str(), "label": _str(nullable=True), "severity": _int(minimum=1, maximum=3)}
    ),
    "FlavorProfile": _obj(
        {
            "axes": _ref("FlavorAxes"),
            "descriptors": _arr(_ref("FlavorDescriptor")),
            "defects": _arr(_ref("FlavorDefect")),
            "tempStage": _str(enum=["hot", "warm", "cool"]),
            "overall": _num(minimum=0, maximum=10),
            "note": _str(),
        }
    ),
    "BrewParams": _obj(
        {
            "doseGrams": _num(),
            "waterGrams": _num(),
            "yieldGrams": _num(),
            "brewSeconds": _int(),
            "temperature": _num(),
            "grindSetting": _str(nullable=True),
            "grindValue": _num(nullable=True),
            "preinfusionSeconds": _int(nullable=True),
            "ratio": _num(nullable=True),
            "waterTds": _int(nullable=True),
            "waterHardness": _int(nullable=True),
        }
    ),
    "BrewStep": _obj(
        {
            "atSecond": _int(),
            "toGrams": _num(),
            "label": _str(),
            "stage": _str(enum=["preinfusion", "bloom", "extraction", "drawdown"]),
        },
        ["atSecond", "toGrams"],
    ),
    "CurvePoint": _obj(
        {
            "t": _int(description="秒"),
            "w": _num(description="累计重量（克）"),
            "flow": _num(description="瞬时流速（克/秒）"),
            "stage": _str(enum=["preinfusion", "bloom", "extraction", "drawdown"]),
        }
    ),
    "CurveStageSpan": _obj(
        {"from": _int(), "to": _int(), "label": _str(), "stage": _str()}
    ),
    "BrewCurve": _obj(
        {
            "id": _str(),
            "ownerType": _str(enum=["brew", "roast"]),
            "ownerId": _str(),
            "source": _str(enum=["plan", "keypoint", "device", "import", "live"]),
            "xAxis": _str(),
            "unit": _str(),
            "points": _arr(_ref("CurvePoint")),
            "stages": _arr(_ref("CurveStageSpan")),
            "meta": {"type": "object", "additionalProperties": True},
        }
    ),
    "BrewImage": _obj(
        {
            "id": _str(nullable=True),
            "objectKey": _str(),
            "url": _str(),
            "caption": _str(nullable=True),
            "width": _int(nullable=True),
            "height": _int(nullable=True),
            "sizeBytes": _int(nullable=True),
        }
    ),
    "BrewRecord": _obj(
        {
            "id": _str(),
            "beanId": _str(),
            "roastBatchId": _str(nullable=True),
            "method": _str(),
            "equipmentIds": _arr(_str()),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "curve": _ref("BrewCurve"),
            "flavor": _ref("FlavorProfile"),
            "notes": _str(),
            "review": _str(nullable=True),
            "images": _arr(_ref("BrewImage")),
            "brewDate": _str(format="date-time"),
            "createdAt": _str(format="date-time"),
            "updatedAt": _str(format="date-time"),
        },
        ["id", "beanId", "method", "params", "steps", "curve", "flavor", "brewDate"],
    ),
    "RoastEvent": _obj(
        {
            "type": _str(enum=["charge", "turningPoint", "dryEnd", "firstCrack", "drop"]),
            "atSecond": _int(),
            "temperature": _num(),
        },
        ["type", "atSecond", "temperature"],
    ),
    "RoastCurvePoint": _obj(
        {"t": _int(), "bt": _num(), "et": _num(nullable=True), "ror": _num(nullable=True)}
    ),
    "RoastBatch": _obj(
        {
            "id": _str(),
            "beanId": _str(),
            "batchNo": _str(),
            "roaster": _str(),
            "greenGrams": _int(),
            "outGrams": _int(),
            "weightLossPercent": _num(),
            "totalSeconds": _int(),
            "events": _arr(_ref("RoastEvent")),
            "dtrPercent": _num(),
            "phaseRatio": _obj(
                {
                    "drying": _num(),
                    "maillard": _num(),
                    "development": _num(),
                }
            ),
            "curve": _arr(_ref("RoastCurvePoint")),
            "cuppingScore": _num(nullable=True),
            "notes": _str(nullable=True),
            "roastDate": _str(format="date-time"),
            "createdAt": _str(format="date-time"),
            "updatedAt": _str(format="date-time"),
        },
        ["id", "beanId", "batchNo"],
    ),
    "Equipment": _obj(
        {
            "id": _str(),
            "type": _str(enum=["grinder", "dripper", "brewer", "espresso", "scale", "roaster", "other"]),
            "name": _str(),
            "brand": _str(nullable=True),
            "model": _str(nullable=True),
            "notes": _str(nullable=True),
            "createdAt": _str(format="date-time"),
            "updatedAt": _str(format="date-time"),
        },
        ["id", "type", "name"],
    ),
    "Recipe": _obj(
        {
            "id": _str(),
            "name": _str(),
            "method": _str(),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "notes": _str(nullable=True),
            "createdAt": _str(format="date-time"),
            "updatedAt": _str(format="date-time"),
        },
        ["id", "name", "method"],
    ),
    "ParamSpec": _obj(
        {
            "key": _str(),
            "label": _str(),
            "required": _bool(),
            "default": _num(nullable=True),
            "target": _num(nullable=True),
            "range": _arr(_num()),
            "unit": _str(nullable=True, enum=["g", "ml", "s", "°C", "bar"]),
            "hint": _str(nullable=True),
            "derived": _bool(),
        }
    ),
    "BrewMethod": _obj(
        {
            "id": _str(),
            "name": _str(),
            "aliases": _arr(_str()),
            "category": _str(enum=["percolation", "immersion", "pressure", "cold"]),
            "summary": _str(),
            "params": {"type": "object", "additionalProperties": _ref("ParamSpec")},
            "grindHint": _str(),
            "flavorBaseline": _ref("FlavorAxes"),
            "flavorCategories": _arr(_str()),
            "tdsRange": _arr(_num()),
            "extractionRange": _arr(_num()),
            "brewStyles": _arr(_str()),
            "defaultSteps": _arr(_ref("BrewStep")),
        }
    ),
    "FlavorWheel": _obj(
        {
            "version": _str(),
            "categories": _arr(
                _obj(
                    {
                        "id": _str(),
                        "label": _str(),
                        "color": _str(),
                        "subcategories": _arr(
                            _obj(
                                {
                                    "id": _str(),
                                    "label": _str(),
                                    "descriptors": _arr(
                                        _obj({"id": _str(), "label": _str()})
                                    ),
                                }
                            )
                        ),
                    }
                )
            ),
            "defects": _arr(_obj({"id": _str(), "label": _str(), "severity": _int()})),
        }
    ),
    "DerivedCurve": _obj(
        {
            "points": _arr(_ref("CurvePoint")),
            "stages": _arr(_ref("CurveStageSpan")),
            "meta": _obj(
                {
                    "generator": _str(),
                    "pointCount": _int(),
                    "source": _str(nullable=True),
                }
            ),
        }
    ),
    "Diagnosis": _obj(
        {
            "matchScore": _int(),
            "verdict": _str(enum=["under_extracted", "over_extracted", "uneven", "flat", "ok"]),
            "verdictLabel": _str(),
            "deviations": _arr(
                _obj(
                    {
                        "axis": _str(),
                        "label": _str(),
                        "actual": _num(),
                        "expected": _num(),
                        "delta": _num(),
                        "direction": _str(enum=["over", "under"]),
                    }
                )
            ),
            "prescriptions": _arr(
                _obj(
                    {
                        "priority": _int(),
                        "action": _str(),
                        "label": _str(),
                        "delta": _str(nullable=True),
                        "reason": _str(),
                        "category": _str(),
                    }
                )
            ),
            "baseline": _ref("FlavorAxes"),
        }
    ),
    "StatsSummary": _obj(
        {
            "today": _obj(
                {"brewCount": _int(), "roastCount": _int(), "avgFlavor": _num()}
            ),
            "week": _obj(
                {
                    "brewCount": _int(),
                    "avgFlavor": _num(),
                    "byMethod": {"type": "object", "additionalProperties": _int()},
                }
            ),
            "restingBeans": _arr(
                _obj(
                    {
                        "beanId": _str(),
                        "name": _str(),
                        "roastDate": _str(),
                        "daysSinceRoast": _int(),
                        "stage": _str(enum=["resting", "peak", "fading"]),
                    }
                )
            ),
            "activeSession": {"type": ["object", "null"], "additionalProperties": True},
        }
    ),
    "UploadTarget": _obj(
        {
            "objectKey": _str(),
            "uploadUrl": _str(),
            "publicUrl": _str(),
            "headers": {"type": "object", "additionalProperties": _str()},
            "expiresIn": _int(),
        }
    ),
    "AuthResult": _obj(
        {
            "token": _str(),
            "refreshToken": _str(),
            "user": _obj({"id": _str(), "nickname": _str(), "avatarUrl": _str()}),
        }
    ),
}


# --------------------------------------------------------------------- #
#  响应辅助
# --------------------------------------------------------------------- #


def _envelope(data_schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return _obj(
        {
            "ok": {"const": True},
            "data": data_schema or {},
            "meta": _ref("Meta"),
        },
        ["ok", "data"],
    )


def _response(description: str, data_schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {
        "description": description,
        "content": {"application/json": {"schema": _envelope(data_schema)}},
    }


def _error_response(description: str) -> Dict[str, Any]:
    return {
        "description": description,
        "content": {"application/json": {"schema": _ref("ErrorEnvelope")}},
    }


_COMMON_ERRORS = {
    "400": _error_response("参数不合法"),
    "401": _error_response("未登录或 token 失效"),
    "403": _error_response("无权访问"),
    "404": _error_response("资源不存在"),
    "409": _error_response("资源冲突"),
    "422": _error_response("语义校验失败"),
    "429": _error_response("请求过于频繁"),
    "500": _error_response("服务端异常"),
}


def _query(name: str, schema: Dict[str, Any], description: str = "") -> Dict[str, Any]:
    return {
        "name": name,
        "in": "query",
        "required": False,
        "schema": schema,
        **({"description": description} if description else {}),
    }


def _path(name: str, description: str) -> Dict[str, Any]:
    return {"name": name, "in": "path", "required": True, "schema": _str(), "description": description}


def _body(schema_name: str) -> Dict[str, Any]:
    return {
        "required": True,
        "content": {"application/json": {"schema": _ref(schema_name)}},
    }


def _list_schema(item: str) -> Dict[str, Any]:
    return _obj({"items": _arr(_ref(item))})


# --------------------------------------------------------------------- #
#  路径
# --------------------------------------------------------------------- #


def _paths() -> Dict[str, Any]:
    pagination_param = _query("cursor", _str(), "游标（不透明字符串）")
    limit_param = _query("limit", _int(minimum=1, maximum=100), "每页数量")
    sort_param = _query("sort", _str(), "排序，如 -brewDate,createdAt")

    paths: Dict[str, Any] = {
        "/auth/wechat": {
            "post": {
                "tags": ["认证"],
                "summary": "微信 code 换 token",
                "operationId": "wechatLogin",
                "requestBody": _body("WechatAuth"),
                "responses": {
                    "200": _response("登录成功", _ref("AuthResult")),
                    **_COMMON_ERRORS,
                },
            }
        },
        "/auth/refresh": {
            "post": {
                "tags": ["认证"],
                "summary": "刷新 token",
                "operationId": "refreshToken",
                "requestBody": _body("RefreshRequest"),
                "responses": {"200": _response("刷新成功", _ref("AuthResult")), **_COMMON_ERRORS},
            }
        },
        "/auth/me": {
            "get": {
                "tags": ["认证"],
                "summary": "当前用户",
                "operationId": "me",
                "responses": {"200": _response("当前用户", _obj({"id": _str(), "nickname": _str()})), **_COMMON_ERRORS},
            }
        },
        "/beans": {
            "get": {
                "tags": ["豆子"],
                "summary": "豆子列表",
                "operationId": "listBeans",
                "parameters": [
                    pagination_param,
                    limit_param,
                    sort_param,
                    _query("q", _str(), "名称/烘焙商/备注模糊搜索"),
                    _query("roastLevel", _str(), "烘焙度筛选"),
                    _query("process", _str(), "处理法筛选"),
                    _query("tag", _str(), "标签筛选"),
                ],
                "responses": {"200": _response("豆子列表", _list_schema("Bean")), **_COMMON_ERRORS},
            },
            "post": {
                "tags": ["豆子"],
                "summary": "新建豆子",
                "operationId": "createBean",
                "requestBody": _body("BeanCreate"),
                "responses": {"201": _response("创建成功", _ref("Bean")), **_COMMON_ERRORS},
            },
        },
        "/beans/{beanId}": {
            "get": {
                "tags": ["豆子"],
                "summary": "豆子详情",
                "operationId": "getBean",
                "parameters": [_path("beanId", "豆子 ID")],
                "responses": {"200": _response("豆子详情", _ref("Bean")), **_COMMON_ERRORS},
            },
            "patch": {
                "tags": ["豆子"],
                "summary": "更新豆子",
                "operationId": "updateBean",
                "parameters": [_path("beanId", "豆子 ID")],
                "requestBody": _body("BeanUpdate"),
                "responses": {"200": _response("更新成功", _ref("Bean")), **_COMMON_ERRORS},
            },
            "delete": {
                "tags": ["豆子"],
                "summary": "删除豆子",
                "operationId": "deleteBean",
                "parameters": [_path("beanId", "豆子 ID")],
                "responses": {"200": _response("已删除", _obj({"ok": _bool()})), **_COMMON_ERRORS},
            },
        },
        "/beans/{beanId}/brews": {
            "get": {
                "tags": ["豆子"],
                "summary": "该豆的冲煮记录",
                "operationId": "beanBrews",
                "parameters": [_path("beanId", "豆子 ID")],
                "responses": {"200": _response("冲煮记录", _list_schema("BrewRecord")), **_COMMON_ERRORS},
            }
        },
        "/beans/{beanId}/roasts": {
            "get": {
                "tags": ["豆子"],
                "summary": "该豆的烘焙批次",
                "operationId": "beanRoasts",
                "parameters": [_path("beanId", "豆子 ID")],
                "responses": {"200": _response("烘焙批次", _list_schema("RoastBatch")), **_COMMON_ERRORS},
            }
        },
        "/beans/{beanId}/trend": {
            "get": {
                "tags": ["豆子"],
                "summary": "该豆的风味趋势",
                "operationId": "beanTrend",
                "parameters": [_path("beanId", "豆子 ID")],
                "responses": {"200": _response("趋势数据"), **_COMMON_ERRORS},
            }
        },
        "/brews": {
            "get": {
                "tags": ["冲煮"],
                "summary": "冲煮列表",
                "operationId": "listBrews",
                "parameters": [
                    pagination_param,
                    limit_param,
                    sort_param,
                    _query("method", _str(), "冲煮方式筛选"),
                    _query("beanId", _str(), "豆子筛选"),
                    _query("roastBatchId", _str(), "烘焙批次筛选"),
                    _query("from", _str(format="date-time"), "起始时间"),
                    _query("to", _str(format="date-time"), "结束时间"),
                ],
                "responses": {"200": _response("冲煮列表", _list_schema("BrewRecord")), **_COMMON_ERRORS},
            },
            "post": {
                "tags": ["冲煮"],
                "summary": "新建冲煮记录",
                "operationId": "createBrew",
                "requestBody": _body("BrewCreate"),
                "responses": {"201": _response("创建成功", _ref("BrewRecord")), **_COMMON_ERRORS},
            },
        },
        "/brews/derive-curve": {
            "post": {
                "tags": ["冲煮"],
                "summary": "★ 由参数或关键点生成曲线",
                "operationId": "deriveCurve",
                "requestBody": _body("DeriveCurveRequest"),
                "responses": {"200": _response("曲线", _ref("DerivedCurve")), **_COMMON_ERRORS},
            }
        },
        "/brews/compare": {
            "post": {
                "tags": ["冲煮"],
                "summary": "★ 多杯对比聚合",
                "operationId": "compareBrews",
                "requestBody": _body("CompareBrewsRequest"),
                "responses": {"200": _response("对比结果"), **_COMMON_ERRORS},
            }
        },
        "/brews/{brewId}": {
            "get": {
                "tags": ["冲煮"],
                "summary": "冲煮详情",
                "operationId": "getBrew",
                "parameters": [_path("brewId", "冲煮记录 ID")],
                "responses": {"200": _response("冲煮详情", _ref("BrewRecord")), **_COMMON_ERRORS},
            },
            "patch": {
                "tags": ["冲煮"],
                "summary": "更新冲煮记录",
                "operationId": "updateBrew",
                "parameters": [_path("brewId", "冲煮记录 ID")],
                "requestBody": _body("BrewUpdate"),
                "responses": {"200": _response("更新成功", _ref("BrewRecord")), **_COMMON_ERRORS},
            },
            "delete": {
                "tags": ["冲煮"],
                "summary": "删除冲煮记录",
                "operationId": "deleteBrew",
                "parameters": [_path("brewId", "冲煮记录 ID")],
                "responses": {"200": _response("已删除", _obj({"ok": _bool()})), **_COMMON_ERRORS},
            },
        },
        "/brews/{brewId}/curve": {
            "post": {
                "tags": ["冲煮"],
                "summary": "写入/替换曲线",
                "operationId": "replaceCurve",
                "parameters": [_path("brewId", "冲煮记录 ID")],
                "requestBody": _body("ReplaceCurveRequest"),
                "responses": {"200": _response("冲煮详情", _ref("BrewRecord")), **_COMMON_ERRORS},
            }
        },
        "/brews/{brewId}/diagnosis": {
            "get": {
                "tags": ["冲煮"],
                "summary": "★ 风味偏差诊断",
                "operationId": "brewDiagnosis",
                "parameters": [_path("brewId", "冲煮记录 ID")],
                "responses": {"200": _response("诊断结果", _ref("Diagnosis")), **_COMMON_ERRORS},
            }
        },
        "/roasts": {
            "get": {
                "tags": ["烘豆"],
                "summary": "烘焙批次列表",
                "operationId": "listRoasts",
                "parameters": [pagination_param, limit_param, sort_param, _query("beanId", _str())],
                "responses": {"200": _response("烘焙批次", _list_schema("RoastBatch")), **_COMMON_ERRORS},
            },
            "post": {
                "tags": ["烘豆"],
                "summary": "新建烘焙批次",
                "operationId": "createRoast",
                "requestBody": _body("RoastCreate"),
                "responses": {"201": _response("创建成功", _ref("RoastBatch")), **_COMMON_ERRORS},
            },
        },
        "/roasts/import": {
            "post": {
                "tags": ["烘豆"],
                "summary": "导入 .alog / CSV / 分享链接",
                "operationId": "importRoast",
                "requestBody": _body("RoastImportRequest"),
                "responses": {"201": _response("导入结果"), **_COMMON_ERRORS},
            }
        },
        "/roasts/compare": {
            "post": {
                "tags": ["烘豆"],
                "summary": "批次叠加对比",
                "operationId": "compareRoasts",
                "requestBody": _body("CompareRoastsRequest"),
                "responses": {"200": _response("对比结果"), **_COMMON_ERRORS},
            }
        },
        "/roasts/{roastId}": {
            "get": {
                "tags": ["烘豆"],
                "summary": "烘焙详情",
                "operationId": "getRoast",
                "parameters": [_path("roastId", "烘焙批次 ID")],
                "responses": {"200": _response("烘焙详情", _ref("RoastBatch")), **_COMMON_ERRORS},
            },
            "patch": {
                "tags": ["烘豆"],
                "summary": "更新烘焙批次",
                "operationId": "updateRoast",
                "parameters": [_path("roastId", "烘焙批次 ID")],
                "requestBody": _body("RoastUpdate"),
                "responses": {"200": _response("更新成功", _ref("RoastBatch")), **_COMMON_ERRORS},
            },
            "delete": {
                "tags": ["烘豆"],
                "summary": "删除烘焙批次",
                "operationId": "deleteRoast",
                "parameters": [_path("roastId", "烘焙批次 ID")],
                "responses": {"200": _response("已删除", _obj({"ok": _bool()})), **_COMMON_ERRORS},
            },
        },
        "/roasts/{roastId}/events": {
            "post": {
                "tags": ["烘豆"],
                "summary": "追加事件打点",
                "operationId": "appendRoastEvent",
                "parameters": [_path("roastId", "烘焙批次 ID")],
                "requestBody": _body("RoastEvent"),
                "responses": {"200": _response("更新后的批次", _ref("RoastBatch")), **_COMMON_ERRORS},
            }
        },
        "/recipes": {
            "get": {
                "tags": ["配方"],
                "summary": "配方列表",
                "operationId": "listRecipes",
                "parameters": [
                    pagination_param,
                    limit_param,
                    sort_param,
                    _query("method", _str()),
                    _query("favorite", _bool()),
                ],
                "responses": {"200": _response("配方列表", _list_schema("Recipe")), **_COMMON_ERRORS},
            },
            "post": {
                "tags": ["配方"],
                "summary": "新建配方",
                "operationId": "createRecipe",
                "requestBody": _body("RecipeCreate"),
                "responses": {"201": _response("创建成功", _ref("Recipe")), **_COMMON_ERRORS},
            },
        },
        "/recipes/{recipeId}": {
            "get": {
                "tags": ["配方"],
                "summary": "配方详情",
                "operationId": "getRecipe",
                "parameters": [_path("recipeId", "配方 ID")],
                "responses": {"200": _response("配方详情", _ref("Recipe")), **_COMMON_ERRORS},
            },
            "patch": {
                "tags": ["配方"],
                "summary": "更新配方",
                "operationId": "updateRecipe",
                "parameters": [_path("recipeId", "配方 ID")],
                "requestBody": _body("RecipeUpdate"),
                "responses": {"200": _response("更新成功", _ref("Recipe")), **_COMMON_ERRORS},
            },
            "delete": {
                "tags": ["配方"],
                "summary": "删除配方",
                "operationId": "deleteRecipe",
                "parameters": [_path("recipeId", "配方 ID")],
                "responses": {"200": _response("已删除", _obj({"ok": _bool()})), **_COMMON_ERRORS},
            },
        },
        "/equipment": {
            "get": {
                "tags": ["器具"],
                "summary": "器具列表",
                "operationId": "listEquipment",
                "parameters": [pagination_param, limit_param, sort_param, _query("type", _str())],
                "responses": {"200": _response("器具列表", _list_schema("Equipment")), **_COMMON_ERRORS},
            },
            "post": {
                "tags": ["器具"],
                "summary": "新增器具",
                "operationId": "createEquipment",
                "requestBody": _body("EquipmentCreate"),
                "responses": {"201": _response("创建成功", _ref("Equipment")), **_COMMON_ERRORS},
            },
        },
        "/equipment/{equipmentId}": {
            "get": {
                "tags": ["器具"],
                "summary": "器具详情",
                "operationId": "getEquipment",
                "parameters": [_path("equipmentId", "器具 ID")],
                "responses": {"200": _response("器具详情", _ref("Equipment")), **_COMMON_ERRORS},
            },
            "patch": {
                "tags": ["器具"],
                "summary": "更新器具",
                "operationId": "updateEquipment",
                "parameters": [_path("equipmentId", "器具 ID")],
                "requestBody": _body("EquipmentUpdate"),
                "responses": {"200": _response("更新成功", _ref("Equipment")), **_COMMON_ERRORS},
            },
            "delete": {
                "tags": ["器具"],
                "summary": "删除器具",
                "operationId": "deleteEquipment",
                "parameters": [_path("equipmentId", "器具 ID")],
                "responses": {"200": _response("已删除", _obj({"ok": _bool()})), **_COMMON_ERRORS},
            }
        },
        "/methods": {
            "get": {
                "tags": ["元数据"],
                "summary": "冲煮方式元数据（参数区间 + 风味基线）",
                "operationId": "listMethods",
                "responses": {"200": _response("方式列表", _list_schema("BrewMethod")), **_COMMON_ERRORS},
            }
        },
        "/flavor-wheel": {
            "get": {
                "tags": ["元数据"],
                "summary": "SCA 风味轮词库",
                "operationId": "flavorWheel",
                "responses": {"200": _response("风味轮", _ref("FlavorWheel")), **_COMMON_ERRORS},
            }
        },
        "/roast-phases": {
            "get": {
                "tags": ["元数据"],
                "summary": "烘焙阶段定义与阈值",
                "operationId": "roastPhases",
                "responses": {"200": _response("阶段定义"), **_COMMON_ERRORS},
            }
        },
        "/stats/summary": {
            "get": {
                "tags": ["统计"],
                "summary": "首页汇总",
                "operationId": "statsSummary",
                "responses": {"200": _response("汇总", _ref("StatsSummary")), **_COMMON_ERRORS},
            }
        },
        "/stats/trends": {
            "get": {
                "tags": ["统计"],
                "summary": "趋势分析",
                "operationId": "statsTrends",
                "parameters": [
                    _query("beanId", _str()),
                    _query("metric", _str()),
                    _query("groupBy", _str(enum=["roastDate", "brewDate"])),
                ],
                "responses": {"200": _response("趋势"), **_COMMON_ERRORS},
            }
        },
        "/uploads/presign": {
            "post": {
                "tags": ["上传"],
                "summary": "申请直传目标（预签名 PUT）",
                "operationId": "presignUpload",
                "requestBody": _body("PresignRequest"),
                "responses": {"200": _response("直传目标", _ref("UploadTarget")), **_COMMON_ERRORS},
            }
        },
        "/uploads": {
            "post": {
                "tags": ["上传"],
                "summary": "直传兜底（后端接收并转存）",
                "operationId": "createUpload",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {"schema": _ref("UploadCreate")},
                        "multipart/form-data": {"schema": _obj({"file": {"type": "string", "format": "binary"}})},
                    },
                },
                "responses": {"201": _response("上传成功", _ref("BrewImage")), **_COMMON_ERRORS},
            },
            "delete": {
                "tags": ["上传"],
                "summary": "删除对象",
                "operationId": "deleteUpload",
                "parameters": [_query("objectKey", _str(), "对象键")],
                "responses": {"200": _response("已删除", _obj({"ok": _bool()})), **_COMMON_ERRORS},
            },
        },
        "/export": {
            "get": {
                "tags": ["数据"],
                "summary": "全量导出（JSON / CSV）",
                "operationId": "exportData",
                "parameters": [
                    _query("format", _str(enum=["json", "csv"])),
                    _query("dataset", _str(enum=["beans", "brews", "roasts", "equipment", "recipes"])),
                ],
                "responses": {"200": _response("导出数据"), **_COMMON_ERRORS},
            }
        },
        "/import": {
            "post": {
                "tags": ["数据"],
                "summary": "全量导入",
                "operationId": "importData",
                "requestBody": _body("ImportRequest"),
                "responses": {"200": _response("导入结果"), **_COMMON_ERRORS},
            }
        },
        "/health": {
            "get": {
                "tags": ["系统"],
                "summary": "健康检查",
                "operationId": "health",
                "responses": {"200": _response("健康状态"), **_COMMON_ERRORS},
            }
        },
    }

    return paths


# --------------------------------------------------------------------- #
#  请求体 schema
# --------------------------------------------------------------------- #


REQUEST_SCHEMAS: Dict[str, Any] = {
    "WechatAuth": _obj({"code": _str(), "nickname": _str(nullable=True), "avatarUrl": _str(nullable=True)}, ["code"]),
    "RefreshRequest": _obj({"refreshToken": _str()}, ["refreshToken"]),
    "BeanCreate": _obj(
        {
            "name": _str(),
            "roaster": _str(nullable=True),
            "origin": _ref("Origin"),
            "process": _str(enum=["washed", "natural", "honey", "anaerobic", "other"]),
            "roastLevel": _str(enum=["light", "medium", "medium_dark", "dark"]),
            "agtron": _int(nullable=True),
            "roastDate": _str(format="date", nullable=True),
            "weightGrams": _int(),
            "remainingGrams": _int(),
            "tags": _arr(_str()),
            "imageUrl": _str(nullable=True),
            "notes": _str(nullable=True),
        },
        ["name"],
    ),
    "BeanUpdate": _obj(
        {
            "name": _str(),
            "roaster": _str(nullable=True),
            "origin": _ref("Origin"),
            "process": _str(enum=["washed", "natural", "honey", "anaerobic", "other"]),
            "roastLevel": _str(enum=["light", "medium", "medium_dark", "dark"]),
            "agtron": _int(nullable=True),
            "roastDate": _str(format="date", nullable=True),
            "weightGrams": _int(),
            "remainingGrams": _int(),
            "tags": _arr(_str()),
            "imageUrl": _str(nullable=True),
            "notes": _str(nullable=True),
        }
    ),
    "BrewCreate": _obj(
        {
            "beanId": _str(),
            "roastBatchId": _str(nullable=True),
            "method": _str(),
            "equipmentIds": _arr(_str()),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "curve": _ref("BrewCurve"),
            "flavor": _ref("FlavorProfile"),
            "notes": _str(nullable=True),
            "review": _str(nullable=True),
            "images": _arr(_ref("BrewImage")),
            "brewDate": _str(format="date-time", nullable=True),
        },
        ["beanId", "method"],
    ),
    "BrewUpdate": _obj(
        {
            "beanId": _str(),
            "roastBatchId": _str(nullable=True),
            "method": _str(),
            "equipmentIds": _arr(_str()),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "curve": _ref("BrewCurve"),
            "flavor": _ref("FlavorProfile"),
            "notes": _str(nullable=True),
            "review": _str(nullable=True),
            "images": _arr(_ref("BrewImage")),
            "brewDate": _str(format="date-time", nullable=True),
        }
    ),
    "ReplaceCurveRequest": _obj(
        {
            "source": _str(enum=["plan", "keypoint", "device", "import", "live"]),
            "points": _arr(_ref("CurvePoint")),
            "stages": _arr(_ref("CurveStageSpan")),
            "keypoints": _arr(_obj({"t": _num(), "w": _num()})),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "meta": {"type": "object", "additionalProperties": True},
        }
    ),
    "DeriveCurveRequest": _obj(
        {
            "method": _str(),
            "mode": _str(enum=["plan", "keypoint"]),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "keypoints": _arr(_obj({"t": _num(), "w": _num()})),
        },
        ["method"],
    ),
    "CompareBrewsRequest": _obj({"brewIds": _arr(_str())}, ["brewIds"]),
    "CompareRoastsRequest": _obj({"roastIds": _arr(_str())}, ["roastIds"]),
    "RoastCreate": _obj(
        {
            "beanId": _str(),
            "batchNo": _str(),
            "roaster": _str(nullable=True),
            "greenGrams": _int(),
            "outGrams": _int(),
            "totalSeconds": _int(),
            "events": _arr(_ref("RoastEvent")),
            "curve": _arr(_ref("RoastCurvePoint")),
            "cuppingScore": _num(nullable=True),
            "notes": _str(nullable=True),
            "roastDate": _str(format="date-time", nullable=True),
            "targetProfileId": _str(nullable=True),
        },
        ["beanId", "batchNo"],
    ),
    "RoastUpdate": _obj(
        {
            "beanId": _str(),
            "batchNo": _str(),
            "roaster": _str(nullable=True),
            "greenGrams": _int(),
            "outGrams": _int(),
            "totalSeconds": _int(),
            "events": _arr(_ref("RoastEvent")),
            "curve": _arr(_ref("RoastCurvePoint")),
            "cuppingScore": _num(nullable=True),
            "notes": _str(nullable=True),
            "roastDate": _str(format="date-time", nullable=True),
            "targetProfileId": _str(nullable=True),
        }
    ),
    "RoastImportRequest": _obj(
        {
            "format": _str(enum=["artisan_alog", "csv", "roest_url"]),
            "beanId": _str(),
            "payload": _str(nullable=True),
            "url": _str(nullable=True),
            "mapping": {"type": "object", "additionalProperties": True, "nullable": True},
            "batchNo": _str(nullable=True),
            "roaster": _str(nullable=True),
            "greenGrams": _int(nullable=True),
            "outGrams": _int(nullable=True),
        },
        ["format", "beanId"],
    ),
    "EquipmentCreate": _obj(
        {
            "type": _str(enum=["grinder", "dripper", "brewer", "espresso", "scale", "roaster", "other"]),
            "name": _str(),
            "brand": _str(nullable=True),
            "model": _str(nullable=True),
            "notes": _str(nullable=True),
        },
        ["type", "name"],
    ),
    "EquipmentUpdate": _obj(
        {
            "type": _str(enum=["grinder", "dripper", "brewer", "espresso", "scale", "roaster", "other"]),
            "name": _str(),
            "brand": _str(nullable=True),
            "model": _str(nullable=True),
            "notes": _str(nullable=True),
        }
    ),
    "RecipeCreate": _obj(
        {
            "name": _str(),
            "method": _str(),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "notes": _str(nullable=True),
            "favorite": _bool(),
        },
        ["name", "method"],
    ),
    "RecipeUpdate": _obj(
        {
            "name": _str(),
            "method": _str(),
            "params": _ref("BrewParams"),
            "steps": _arr(_ref("BrewStep")),
            "notes": _str(nullable=True),
            "favorite": _bool(),
        }
    ),
    "PresignRequest": _obj(
        {
            "filename": _str(),
            "contentType": _str(nullable=True),
            "sizeBytes": _int(nullable=True),
            "purpose": _str(enum=["brew", "roast", "bean"]),
        },
        ["filename"],
    ),
    "UploadCreate": _obj(
        {
            "filename": _str(),
            "dataUri": _str(nullable=True),
            "sizeBytes": _int(nullable=True),
            "contentType": _str(nullable=True),
            "caption": _str(nullable=True),
        },
        ["filename"],
    ),
    "ImportRequest": _obj(
        {
            "beans": _arr(_ref("Bean")),
            "brews": _arr(_ref("BrewRecord")),
            "roasts": _arr(_ref("RoastBatch")),
            "equipment": _arr(_ref("Equipment")),
            "recipes": _arr(_ref("Recipe")),
        }
    ),
}


def build_spec() -> Dict[str, Any]:
    """生成完整的 OpenAPI 3.1 文档。"""
    schemas = {**SCHEMAS, **REQUEST_SCHEMAS}
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "ppCoffe API",
            "version": "1.0.0",
            "description": (
                "ppCoffe 后端接口：冲煮 + 烘焙双链路咖啡记录工具。\n\n"
                "统一响应包络：成功 `{\"ok\": true, \"data\": ..., \"meta\": {...}}`；"
                "失败 `{\"ok\": false, \"error\": {...}, \"meta\": {...}}`。\n\n"
                "接口契约见 `docs/02-接口契约.md`。"
            ),
            "license": {"name": "MIT"},
        },
        "servers": [
            {"url": "http://127.0.0.1:8000/api/v1", "description": "本地开发"},
            {"url": "{host}/api/v1", "description": "生产", "variables": {"host": {"default": "https://api.example.com"}}},
        ],
        "tags": [
            {"name": "认证"},
            {"name": "豆子"},
            {"name": "冲煮"},
            {"name": "烘豆"},
            {"name": "配方"},
            {"name": "器具"},
            {"name": "元数据"},
            {"name": "统计"},
            {"name": "上传"},
            {"name": "数据"},
            {"name": "系统"},
        ],
        "security": [{"bearerAuth": []}],
        "paths": _paths(),
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                    "description": "微信 code 换取的访问令牌：`Authorization: Bearer <token>`",
                }
            },
            "schemas": schemas,
        },
    }
