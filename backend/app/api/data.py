"""数据导入导出：``/api/v1/export``、``/api/v1/import``。

数据导出是刚需（用户要能带走自己的数据），见 docs/00-产品与页面规划.md 第 1.1 节。
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, Dict, List

from flask import Blueprint, Response, request

from ..envelope import ok
from ..errors import ValidationFailed
from ..extensions import db
from ..ids import new_id
from ..models.bean import BEAN_KINDS, Bean
from ..models.brew import BrewCurve, BrewRecord
from ..models.misc import Equipment, Recipe
from ..models.mixins import utcnow
from ..models.rest import REST_EVENT_TYPES, RestEvent
from ..models.roast import RoastBatch, RoastCurve
from ..security import current_user, ensure_owner
from ..services.validation import assert_roast_quantity, lock_bean_for_stock
from .brews import validate_brew_source
from .helpers import json_body, parse_date, parse_datetime, scope
from .rest_events import validate_rest_placement

bp = Blueprint("data", __name__)

DATASETS = ("beans", "brews", "roasts", "equipment", "recipes")


def _collect() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "beans": [b.to_dict() for b in scope(db.session.query(Bean), Bean).all()],
        "brews": [b.to_dict() for b in scope(db.session.query(BrewRecord), BrewRecord).all()],
        "roasts": [r.to_dict() for r in scope(db.session.query(RoastBatch), RoastBatch).all()],
        "equipment": [e.to_dict() for e in scope(db.session.query(Equipment), Equipment).all()],
        "recipes": [r.to_dict() for r in scope(db.session.query(Recipe), Recipe).all()],
        "restEvents": [e.to_dict() for e in scope(db.session.query(RestEvent), RestEvent).all()],
    }


@bp.get("/export")
def export():
    """全量导出（JSON / CSV）。"""
    fmt = (request.args.get("format") or "json").lower()
    dataset = request.args.get("dataset")
    data = _collect()

    if fmt == "json":
        payload = {
            "version": 1,
            "exportedAt": utcnow().isoformat() + "Z",
            "data": data if not dataset else {dataset: data.get(dataset, [])},
        }
        return ok(payload)

    if fmt != "csv":
        raise ValidationFailed("format 只支持 json / csv", field="format")

    # CSV：默认导出冲煮记录（六轴风味拍平）
    target = dataset or "brews"
    if target not in DATASETS:
        raise ValidationFailed(f"dataset 只支持 {', '.join(DATASETS)}", field="dataset")

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    if target == "brews":
        writer.writerow(
            [
                "id",
                "beanId",
                "method",
                "doseGrams",
                "waterGrams",
                "yieldGrams",
                "ratio",
                "brewSeconds",
                "temperature",
                "grindSetting",
                "acidity",
                "sweetness",
                "body",
                "flavor",
                "aftertaste",
                "balance",
                "overall",
                "brewDate",
                "notes",
            ]
        )
        for brew in data["brews"]:
            params = brew.get("params") or {}
            axes = (brew.get("flavor") or {}).get("axes") or {}
            writer.writerow(
                [
                    brew.get("id"),
                    brew.get("beanId"),
                    brew.get("method"),
                    params.get("doseGrams"),
                    params.get("waterGrams"),
                    params.get("yieldGrams"),
                    params.get("ratio"),
                    params.get("brewSeconds"),
                    params.get("temperature"),
                    params.get("grindSetting"),
                    axes.get("acidity"),
                    axes.get("sweetness"),
                    axes.get("body"),
                    axes.get("flavor"),
                    axes.get("aftertaste"),
                    axes.get("balance"),
                    (brew.get("flavor") or {}).get("overall"),
                    brew.get("brewDate"),
                    brew.get("notes"),
                ]
            )
    elif target == "roasts":
        writer.writerow(
            ["id", "beanId", "batchNo", "roaster", "greenGrams", "outGrams", "weightLossPercent", "totalSeconds", "dtrPercent", "cuppingScore", "roastDate"]
        )
        for roast in data["roasts"]:
            writer.writerow(
                [
                    roast.get("id"),
                    roast.get("beanId"),
                    roast.get("batchNo"),
                    roast.get("roaster"),
                    roast.get("greenGrams"),
                    roast.get("outGrams"),
                    roast.get("weightLossPercent"),
                    roast.get("totalSeconds"),
                    roast.get("dtrPercent"),
                    roast.get("cuppingScore"),
                    roast.get("roastDate"),
                ]
            )
    else:
        writer.writerow(["id", "name", "type", "createdAt"])
        for item in data[target]:
            writer.writerow(
                [
                    item.get("id"),
                    item.get("name"),
                    item.get("type") or item.get("method"),
                    item.get("createdAt"),
                ]
            )

    filename = f"ppcoffe-{target}-{utcnow():%Y%m%d-%H%M%S}.csv"
    return Response(
        buffer.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@bp.post("/import")
def import_data():
    """全量导入（恢复备份）。"""
    body = json_body()
    if not isinstance(body, dict):
        raise ValidationFailed("请求体必须是 JSON 对象")
    if "data" in body:
        body = body["data"]
        if not isinstance(body, dict):
            raise ValidationFailed("备份数据必须是 JSON 对象", field="data")

    user = current_user()
    user_id = user.id if user else None
    counts = dict.fromkeys((*DATASETS, "restEvents"), 0)
    restored_beans: Dict[str, Bean] = {}

    for item in body.get("beans") or []:
        kind = item.get("kind")
        cost = item.get("purchaseCostCents")
        if kind is not None and kind not in BEAN_KINDS:
            raise ValidationFailed("豆子类型无效", field="kind")
        if cost is not None and (type(cost) is not int or not 0 <= cost <= 2147483647):
            raise ValidationFailed("实付豆款须为非负整数分", field="purchaseCostCents")
        bean = Bean(
            id=item.get("id") or new_id("bn"),
            user_id=user_id,
            name=item.get("name") or "未命名豆子",
            roaster=item.get("roaster"),
            origin=item.get("origin"),
            process=item.get("process"),
            roast_level=None if kind == "green" else item.get("roastLevel"),
            agtron=item.get("agtron"),
            weight_grams=int(item.get("weightGrams") or 0),
            remaining_grams=int(item.get("remainingGrams") or 0),
            tags=item.get("tags") or [],
            image_url=item.get("imageUrl"),
            notes=item.get("notes"),
            kind=kind,
            purchase_cost_cents=cost,
        )
        if kind != "green" and item.get("roastDate"):
            bean.roast_date = parse_date(item["roastDate"], name="roastDate")
        if key := item.get("sourceFileKey"):
            from .beans import _validate_source_file_key

            _validate_source_file_key({"sourceFileKey": key})
            bean.source_file_key = key
        db.session.add(bean)
        restored_beans[bean.id] = bean
        counts["beans"] += 1
    db.session.flush()

    for item in body.get("equipment") or []:
        db.session.add(
            Equipment(
                id=item.get("id") or new_id("eq"),
                user_id=user_id,
                type=item.get("type") or "other",
                name=item.get("name") or "未命名器具",
                brand=item.get("brand"),
                model=item.get("model"),
                notes=item.get("notes"),
            )
        )
        counts["equipment"] += 1

    for item in body.get("recipes") or []:
        db.session.add(
            Recipe(
                id=item.get("id") or new_id("rc"),
                user_id=user_id,
                name=item.get("name") or "未命名配方",
                method=item.get("method") or "pour_over_v60",
                params=item.get("params") or {},
                steps=item.get("steps") or [],
                notes=item.get("notes"),
            )
        )
        counts["recipes"] += 1

    for item in body.get("roasts") or []:
        bean_id = item.get("beanId")
        bean = restored_beans.get(bean_id)
        restoring_history = bean is not None
        if not restoring_history:
            bean = lock_bean_for_stock(bean_id)
            ensure_owner(bean, user)
            if bean.kind != "green":
                raise ValidationFailed("只有生豆可以导入新的烘焙批次", field="beanId")
        roast = RoastBatch(
            id=item.get("id") or new_id("rb"),
            user_id=user_id,
            bean_id=bean_id,
            batch_no=item.get("batchNo") or "imported",
            roaster=item.get("roaster"),
            green_grams=int(item.get("greenGrams") or 0),
            out_grams=int(item.get("outGrams") or 0),
            weight_loss_percent=float(item.get("weightLossPercent") or 0),
            total_seconds=int(item.get("totalSeconds") or 0),
            events=item.get("events") or [],
            dtr_percent=float(item.get("dtrPercent") or 0),
            phase_ratio=item.get("phaseRatio"),
            cupping_score=item.get("cuppingScore"),
            notes=item.get("notes"),
            roast_level=item.get("roastLevel"),
            roast_date=parse_datetime(item.get("roastDate"), name="roastDate") or utcnow(),
        )
        if not restoring_history or (bean.kind == "green" and roast.is_completed()):
            assert_roast_quantity(bean, roast.green_grams, roast.out_grams)
        curve = item.get("curve") or {}
        if curve.get("points"):
            roast.curve = RoastCurve(
                id=curve.get("id") or new_id("cv"),
                source=curve.get("source") or "import",
                x_axis=curve.get("xAxis") or "time",
                unit=curve.get("unit") or "second",
                points=curve["points"],
                events=curve.get("events") or [],
                meta=curve.get("meta") or {},
            )
        db.session.add(roast)
        db.session.flush()
        counts["roasts"] += 1

    for item in body.get("brews") or []:
        bean_id = item.get("beanId")
        roast_id = item.get("roastBatchId")
        brew_date = parse_datetime(item.get("brewDate"), name="brewDate") or utcnow()
        if bean_id not in restored_beans:
            validate_brew_source(bean_id, roast_id, brew_date)
        elif roast_id:
            roast = db.session.get(RoastBatch, roast_id)
            if roast is None or roast.bean_id != bean_id:
                raise ValidationFailed("烘焙批次不属于所选豆子", field="roastBatchId")
            ensure_owner(roast, user)
        brew = BrewRecord(
            id=item.get("id") or new_id("br"),
            user_id=user_id,
            bean_id=bean_id,
            roast_batch_id=roast_id,
            method=item.get("method") or "pour_over_v60",
            equipment_ids=item.get("equipmentIds"),
            params=item.get("params") or {},
            steps=item.get("steps") or [],
            flavor=item.get("flavor") or {},
            notes=item.get("notes"),
            review=item.get("review"),
            images=item.get("images"),
            brew_date=brew_date,
        )
        db.session.add(brew)
        curve = item.get("curve") or {}
        if curve.get("points"):
            brew.curve = BrewCurve(
                id=curve.get("id") or new_id("cv"),
                source=curve.get("source", "plan"),
                points=curve["points"],
                stages=curve.get("stages") or [],
                meta=curve.get("meta") or {},
            )
        counts["brews"] += 1

    for item in body.get("restEvents") or []:
        bean = lock_bean_for_stock(item.get("beanId"))
        ensure_owner(bean, user)
        roast_id = item.get("roastBatchId")
        validate_rest_placement(bean, roast_id)
        if item.get("type") not in REST_EVENT_TYPES:
            raise ValidationFailed("养豆事件类型无效", field="type")
        db.session.add(RestEvent(
            id=item.get("id") or new_id("re"),
            user_id=user_id,
            bean_id=bean.id,
            roast_batch_id=roast_id,
            type=item["type"],
            occurred_at=parse_datetime(item.get("occurredAt"), name="occurredAt") or utcnow(),
            note=item.get("note"),
        ))
        counts["restEvents"] += 1

    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok({"imported": counts, "total": sum(counts.values())})
