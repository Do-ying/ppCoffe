"""冲煮记录接口：``/api/v1/brews``。

含本产品的核心差异化端点：

* ``POST /brews/derive-curve`` —— 由注水计划 / 关键点生成曲线（服务端权威口径）
* ``GET  /brews/{id}/diagnosis`` —— 风味偏差诊断与「下一杯怎么改」
* ``POST /brews/compare`` —— 多杯参数/风味差异聚合
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from flask import Blueprint, request
from sqlalchemy import and_

from ..domain import curve as brew_curve
from ..domain.diagnosis import diagnose
from ..domain.flavor import FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS
from ..domain.methods import find_method, method_map, validate_params
from ..envelope import ok
from ..errors import NotFound, ValidationFailed
from ..extensions import db
from ..ids import new_id
from ..models.bean import Bean
from ..models.brew import BrewCurve, BrewRecord
from ..models.mixins import utcnow
from ..models.roast import RoastBatch
from ..schemas import BrewCreateSchema, BrewUpdateSchema, CompareBrewsSchema, DeriveCurveSchema
from ..security import current_user, ensure_owner
from .helpers import (
    page_size,
    paginate,
    parse_datetime,
    parse_sort,
    parse_with,
    scope,
)

bp = Blueprint("brews", __name__)

SORT_FIELDS = {
    "brewDate": BrewRecord.brew_date,
    "createdAt": BrewRecord.created_at,
    "updatedAt": BrewRecord.updated_at,
    "method": BrewRecord.method,
}

PARAM_LABELS = {
    "doseGrams": "粉量",
    "waterGrams": "注水量",
    "yieldGrams": "出液量",
    "brewSeconds": "萃取时间",
    "temperature": "水温",
    "ratio": "粉水比",
    "preinfusionSeconds": "预浸",
    "grindSetting": "研磨度",
}


def _get_brew(brew_id: str) -> BrewRecord:
    brew = db.session.get(BrewRecord, brew_id)
    if brew is None:
        raise NotFound("冲煮记录不存在")
    ensure_owner(brew, current_user())
    return brew


def _default_steps(method_id: str) -> List[Dict[str, Any]]:
    method = method_map().get(method_id)
    if not method:
        return []
    return [dict(s) for s in method.get("defaultSteps", [])]


def _build_curve(
    method_id: str,
    params: Dict[str, Any],
    steps: Optional[List[Dict[str, Any]]],
    *,
    source: str = "plan",
) -> Dict[str, Any]:
    """生成曲线：优先用传入的注水计划，否则用方式默认计划。"""
    plan = steps if steps else _default_steps(method_id)
    total = int(params.get("brewSeconds") or 0)
    if not total:
        method = method_map().get(method_id)
        total = int((method or {}).get("params", {}).get("brewSeconds", {}).get("default", 180))
    return brew_curve.generate_plan_curve(plan, total)


def _validate_params(method_id: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """参数越界检查：仅「error」级别阻断保存，warn 级照常保存。"""
    issues = validate_params(method_id, params)
    blocking = [i for i in issues if i["severity"] == "error"]
    if blocking:
        raise ValidationFailed(
            "冲煮参数超出该方式的允许区间",
            details={"issues": blocking},
            field=blocking[0]["field"],
        )
    return issues


def _sync_curve(brew: BrewRecord, curve_data: Dict[str, Any]) -> None:
    """写入/替换冲煮曲线。"""
    if brew.curve is None:
        brew.curve = BrewCurve(id=new_id("cv"), brew_id=brew.id)
        db.session.add(brew.curve)
    brew.curve.source = curve_data.get("source") or brew.curve.source or "plan"
    brew.curve.points = curve_data.get("points") or []
    brew.curve.stages = curve_data.get("stages") or []
    brew.curve.meta = curve_data.get("meta") or {}


# --------------------------------------------------------------------- #
#  列表 / 创建
# --------------------------------------------------------------------- #


@bp.get("")
def list_brews():
    """冲煮列表（多条件筛选 + 游标分页）。"""
    query = scope(db.session.query(BrewRecord), BrewRecord)

    if request.args.get("method"):
        query = query.filter(BrewRecord.method == request.args["method"])
    if request.args.get("beanId"):
        query = query.filter(BrewRecord.bean_id == request.args["beanId"])
    if request.args.get("roastBatchId"):
        query = query.filter(BrewRecord.roast_batch_id == request.args["roastBatchId"])
    if request.args.get("from"):
        query = query.filter(BrewRecord.brew_date >= parse_datetime(request.args["from"], name="from"))
    if request.args.get("to"):
        query = query.filter(BrewRecord.brew_date <= parse_datetime(request.args["to"], name="to"))

    sort_fields = parse_sort(request.args.get("sort"), SORT_FIELDS, "brewDate")
    if len(sort_fields) == 1 and sort_fields[0][0] is BrewRecord.brew_date:
        sort_fields = [(BrewRecord.brew_date, True), (BrewRecord.id, True)]

    rows, next_cursor, has_more = paginate(
        query,
        model=BrewRecord,
        sort_fields=sort_fields,
        cursor=request.args.get("cursor"),
        limit=page_size(),
    )
    return ok(
        {"items": [b.to_dict() for b in rows]},
        pagination={"nextCursor": next_cursor, "hasMore": has_more, "limit": page_size()},
    )


@bp.post("")
def create_brew():
    """新建冲煮记录。"""
    data = parse_with(BrewCreateSchema())
    user = current_user()

    bean = db.session.get(Bean, data["beanId"])
    if bean is None:
        raise ValidationFailed("豆子不存在", details={"beanId": data["beanId"]}, field="beanId")

    method = find_method(data["method"])
    if method is None:
        raise ValidationFailed(
            "未知的冲煮方式",
            details={"method": data["method"]},
            field="method",
        )

    if data.get("roastBatchId"):
        roast = db.session.get(RoastBatch, data["roastBatchId"])
        if roast is None:
            raise ValidationFailed(
                "烘焙批次不存在", details={"roastBatchId": data["roastBatchId"]}, field="roastBatchId"
            )

    params = dict(data.get("params") or {})
    # 粉水比由粉量/注水量派生
    if params.get("doseGrams") and params.get("waterGrams") and not params.get("ratio"):
        params["ratio"] = round(params["waterGrams"] / params["doseGrams"], 2)

    _validate_params(data["method"], params)

    steps = data.get("steps") or _default_steps(data["method"])
    curve_data = data.get("curve") or _build_curve(data["method"], params, steps)

    brew = BrewRecord(
        id=new_id("br"),
        user_id=user.id if user else None,
        bean_id=data["beanId"],
        roast_batch_id=data.get("roastBatchId"),
        method=data["method"],
        equipment_ids=data.get("equipmentIds"),
        params=params,
        steps=steps,
        flavor=data.get("flavor") or {},
        notes=data.get("notes"),
        review=data.get("review"),
        images=data.get("images"),
        brew_date=parse_datetime(data.get("brewDate"), name="brewDate") or utcnow(),
    )
    db.session.add(brew)
    db.session.flush()

    curve_row = BrewCurve(
        id=new_id("cv"),
        brew_id=brew.id,
        source=curve_data.get("source", "plan"),
        points=curve_data.get("points") or [],
        stages=curve_data.get("stages") or [],
        meta=curve_data.get("meta") or {},
    )
    db.session.add(curve_row)
    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok(brew.to_dict(), status=201)


# --------------------------------------------------------------------- #
#  详情 / 更新 / 删除
# --------------------------------------------------------------------- #


@bp.get("/<brew_id>")
def get_brew(brew_id: str):
    """冲煮详情。"""
    return ok(_get_brew(brew_id).to_dict())


@bp.patch("/<brew_id>")
def update_brew(brew_id: str):
    """更新冲煮记录。"""
    brew = _get_brew(brew_id)
    data = parse_with(BrewUpdateSchema(), partial=True)

    if "beanId" in data:
        if db.session.get(Bean, data["beanId"]) is None:
            raise ValidationFailed("豆子不存在", details={"beanId": data["beanId"]}, field="beanId")
        brew.bean_id = data["beanId"]
    if "roastBatchId" in data:
        brew.roast_batch_id = data.get("roastBatchId")
    if "method" in data:
        if find_method(data["method"]) is None:
            raise ValidationFailed("未知的冲煮方式", field="method")
        brew.method = data["method"]
    if "equipmentIds" in data:
        brew.equipment_ids = data.get("equipmentIds")
    if "params" in data:
        params = dict(brew.params or {})
        params.update(data["params"] or {})
        if params.get("doseGrams") and params.get("waterGrams"):
            params["ratio"] = round(params["waterGrams"] / params["doseGrams"], 2)
        _validate_params(brew.method, params)
        brew.params = params
    if "steps" in data:
        brew.steps = data.get("steps") or []
    if "flavor" in data:
        brew.flavor = data.get("flavor") or {}
    if "notes" in data:
        brew.notes = data.get("notes")
    if "review" in data:
        brew.review = data.get("review")
    if "images" in data:
        brew.images = data.get("images")
    if "brewDate" in data:
        brew.brew_date = parse_datetime(data.get("brewDate"), name="brewDate") or brew.brew_date
    if "curve" in data:
        _sync_curve(brew, data["curve"] or {})

    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok(brew.to_dict())


@bp.delete("/<brew_id>")
def delete_brew(brew_id: str):
    """删除冲煮记录（同时删除其曲线与关联对象）。"""
    brew = _get_brew(brew_id)
    for image in brew.images or []:
        object_key = image.get("objectKey")
        if object_key:
            try:
                from ..services.storage import get_storage

                get_storage().delete_object(object_key)
            except Exception:  # pragma: no cover - 清理失败不应阻断删除
                pass
    db.session.delete(brew)
    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok({"ok": True})


# --------------------------------------------------------------------- #
#  曲线
# --------------------------------------------------------------------- #


@bp.post("/<brew_id>/curve")
def replace_curve(brew_id: str):
    """写入/替换冲煮曲线。"""
    brew = _get_brew(brew_id)
    body = request.get_json(silent=True) or {}

    if body.get("points"):
        curve_data = {
            "source": body.get("source", "device"),
            "points": body["points"],
            "stages": body.get("stages") or [],
            "meta": body.get("meta") or {},
        }
    elif body.get("keypoints"):
        curve_data = brew_curve.generate_keypoint_curve(body["keypoints"])
        curve_data["meta"] = {"generator": "monotone-cubic-v1"}
    else:
        params = body.get("params") or brew.params or {}
        steps = body.get("steps") or brew.steps or []
        curve_data = _build_curve(brew.method, params, steps)
        curve_data["meta"] = {"generator": "monotone-cubic-v1"}

    _sync_curve(brew, curve_data)
    db.session.commit()
    return ok(brew.to_dict())


@bp.post("/derive-curve")
def derive_curve():
    """由参数或关键点生成曲线（服务端权威口径）。"""
    data = parse_with(DeriveCurveSchema())
    method = find_method(data["method"])
    if method is None:
        raise NotFound("冲煮方式不存在")

    mode = data.get("mode") or "plan"
    params = data.get("params") or {}

    if mode == "keypoint":
        keypoints = data.get("keypoints") or []
        if len(keypoints) < 2:
            raise ValidationFailed("关键点至少需要 2 个", field="keypoints")
        curve = brew_curve.generate_keypoint_curve(keypoints)
    else:
        steps = data.get("steps") or _default_steps(data["method"])
        if not steps:
            raise ValidationFailed("缺少注水计划", field="steps")
        total = int(params.get("brewSeconds") or 0)
        if not total:
            total = int(method.get("params", {}).get("brewSeconds", {}).get("default", 180))
        curve = brew_curve.generate_plan_curve(steps, total)

    return ok(
        {
            "points": curve["points"],
            "stages": curve["stages"],
            "meta": {
                "generator": "monotone-cubic-v1",
                "pointCount": len(curve["points"]),
                "source": curve["source"],
            },
        }
    )


# --------------------------------------------------------------------- #
#  对比 / 诊断
# --------------------------------------------------------------------- #


@bp.post("/compare")
def compare_brews():
    """多杯对比聚合。"""
    data = parse_with(CompareBrewsSchema())
    ids = data["brewIds"]
    brews = scope(db.session.query(BrewRecord), BrewRecord).filter(BrewRecord.id.in_(ids)).all()
    # 保持请求顺序
    ordered = [b for bid in ids for b in brews if b.id == bid]

    param_fields: List[str] = []
    for brew in ordered:
        for key in (brew.params or {}):
            if key not in param_fields:
                param_fields.append(key)

    param_diff: List[Dict[str, Any]] = []
    for key in param_fields:
        values = [(brew.params or {}).get(key) for brew in ordered]
        numeric = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if len(numeric) == len(values) and len(set(numeric)) > 1:
            delta = round(numeric[-1] - numeric[0], 2)
            param_diff.append(
                {
                    "field": f"params.{key}",
                    "label": PARAM_LABELS.get(key, key),
                    "values": values,
                    "delta": delta,
                }
            )

    flavor_diff: List[Dict[str, Any]] = []
    for axis in FLAVOR_AXIS_KEYS:
        values = [((brew.flavor or {}).get("axes") or {}).get(axis) for brew in ordered]
        numeric = [v for v in values if isinstance(v, (int, float))]
        if len(numeric) == len(values) and len(numeric) > 1:
            flavor_diff.append(
                {
                    "axis": axis,
                    "label": FLAVOR_AXIS_LABELS[axis],
                    "values": values,
                    "delta": round(numeric[-1] - numeric[0], 2),
                }
            )

    curves = [
        {
            "id": brew.id,
            "source": brew.curve.source if brew.curve else "plan",
            "points": (brew.curve.points if brew.curve else []) or [],
            "stages": (brew.curve.stages if brew.curve else []) or [],
        }
        for brew in ordered
    ]

    return ok(
        {
            "brews": [b.to_dict() for b in ordered],
            "paramDiff": param_diff,
            "flavorDiff": flavor_diff,
            "curves": curves,
        }
    )


@bp.get("/<brew_id>/diagnosis")
def brew_diagnosis(brew_id: str):
    """风味偏差诊断：与方式基线对比，输出「下一杯怎么改」。"""
    brew = _get_brew(brew_id)
    method = method_map().get(brew.method)
    if method is None:
        from ..domain.methods import get_flavor_baseline

        method = {
            "id": brew.method,
            "name": brew.method,
            "category": "percolation",
            "flavorBaseline": get_flavor_baseline(brew.method),
        }

    flavor = brew.flavor or {}
    if not flavor.get("axes"):
        raise ValidationFailed("该记录还没有风味数据", field="flavor")

    return ok(diagnose(method, flavor))
