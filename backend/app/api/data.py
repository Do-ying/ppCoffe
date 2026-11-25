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
from ..models.bean import Bean
from ..models.brew import BrewCurve, BrewRecord
from ..models.misc import Equipment, Recipe
from ..models.mixins import utcnow
from ..models.roast import RoastBatch, RoastCurve
from ..security import current_user
from .helpers import json_body, scope

bp = Blueprint("data", __name__)

DATASETS = ("beans", "brews", "roasts", "equipment", "recipes")


def _collect() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "beans": [b.to_dict() for b in scope(db.session.query(Bean), Bean).all()],
        "brews": [b.to_dict() for b in scope(db.session.query(BrewRecord), BrewRecord).all()],
        "roasts": [r.to_dict() for r in scope(db.session.query(RoastBatch), RoastBatch).all()],
        "equipment": [e.to_dict() for e in scope(db.session.query(Equipment), Equipment).all()],
        "recipes": [r.to_dict() for r in scope(db.session.query(Recipe), Recipe).all()],
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

    user = current_user()
    user_id = user.id if user else None
    counts = {"beans": 0, "brews": 0, "roasts": 0, "equipment": 0, "recipes": 0}

    for item in body.get("beans") or []:
        bean = Bean(
            id=item.get("id") or new_id("bn"),
            user_id=user_id,
            name=item.get("name") or "未命名豆子",
            roaster=item.get("roaster"),
            origin=item.get("origin"),
            process=item.get("process"),
            roast_level=item.get("roastLevel"),
            agtron=item.get("agtron"),
            weight_grams=int(item.get("weightGrams") or 0),
            remaining_grams=int(item.get("remainingGrams") or 0),
            tags=item.get("tags") or [],
            image_url=item.get("imageUrl"),
            notes=item.get("notes"),
        )
        if item.get("roastDate"):
            from ..api.helpers import parse_date

            bean.roast_date = parse_date(item["roastDate"], name="roastDate")
        db.session.add(bean)
        counts["beans"] += 1

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
        roast = RoastBatch(
            id=item.get("id") or new_id("rb"),
            user_id=user_id,
            bean_id=item.get("beanId"),
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
        )
        db.session.add(roast)
        counts["roasts"] += 1

    for item in body.get("brews") or []:
        brew = BrewRecord(
            id=item.get("id") or new_id("br"),
            user_id=user_id,
            bean_id=item.get("beanId"),
            roast_batch_id=item.get("roastBatchId"),
            method=item.get("method") or "pour_over_v60",
            equipment_ids=item.get("equipmentIds"),
            params=item.get("params") or {},
            steps=item.get("steps") or [],
            flavor=item.get("flavor") or {},
            notes=item.get("notes"),
            review=item.get("review"),
            images=item.get("images"),
        )
        db.session.add(brew)
        curve = item.get("curve") or {}
        if curve.get("points"):
            db.session.add(
                BrewCurve(
                    id=new_id("cv"),
                    brew_id=brew.id,
                    source=curve.get("source", "plan"),
                    points=curve.get("points") or [],
                    stages=curve.get("stages") or [],
                    meta=curve.get("meta") or {},
                )
            )
        counts["brews"] += 1

    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok({"imported": counts, "total": sum(counts.values())})
