"""烘豆接口：``/api/v1/roasts``。

含 ``POST /roasts/import``（Artisan .alog / CSV / Roest 分享链接导入）
与 ``POST /roasts/compare``（批次叠加对比）。
"""

from __future__ import annotations

import base64
import binascii
import csv
import io
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Blueprint, request

from ..domain import roast as roast_domain
from ..envelope import ok
from ..errors import ApiError, Conflict, NotFound, ValidationFailed
from ..extensions import db
from ..ids import new_id
from ..models.bean import Bean
from ..models.mixins import utcnow
from ..models.roast import RoastBatch, RoastCurve
from ..schemas import CompareRoastsSchema, RoastCreateSchema, RoastImportSchema, RoastUpdateSchema
from ..security import current_user, ensure_owner
from .helpers import page_size, paginate, parse_datetime, parse_sort, parse_with, scope

bp = Blueprint("roasts", __name__)

SORT_FIELDS = {
    "roastDate": RoastBatch.roast_date,
    "createdAt": RoastBatch.created_at,
    "updatedAt": RoastBatch.updated_at,
    "batchNo": RoastBatch.batch_no,
}

METRIC_LABELS = {
    "weightLossPercent": "失重率",
    "dtrPercent": "发展比",
    "totalSeconds": "总时长",
    "greenGrams": "投豆量",
    "outGrams": "出豆量",
    "cuppingScore": "杯测分",
}


def _get_roast(roast_id: str) -> RoastBatch:
    roast = db.session.get(RoastBatch, roast_id)
    if roast is None:
        raise NotFound("烘焙批次不存在")
    ensure_owner(roast, current_user())
    return roast


def _recompute(roast: RoastBatch) -> None:
    """根据事件重算失重率 / 发展比 / 阶段占比。"""
    metrics = roast_domain.compute_roast_metrics(
        {
            "greenGrams": roast.green_grams or 0,
            "outGrams": roast.out_grams or 0,
            "totalSeconds": roast.total_seconds or 0,
            "events": roast.events or [],
        }
    )
    roast.weight_loss_percent = metrics["weightLossPercent"]
    roast.dtr_percent = metrics["dtrPercent"]
    roast.phase_ratio = metrics["phaseRatio"]


def _ensure_curve(
    roast: RoastBatch, points: List[Dict[str, Any]], source: str, meta: Optional[Dict[str, Any]] = None
) -> None:
    if roast.curve is None:
        roast.curve = RoastCurve(id=new_id("cv"), roast_id=roast.id)
        db.session.add(roast.curve)
    roast.curve.source = source
    roast.curve.points = points
    roast.curve.events = roast.events or []
    roast.curve.meta = meta or {}


def _parse_csv(text: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    """解析通用 CSV（表头需含 time/bt/et 或等价列名）。"""
    warnings: List[str] = []
    points: List[Dict[str, Any]] = []
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValidationFailed("CSV 没有表头", field="payload")

    lowered = {name.strip().lower(): name for name in reader.fieldnames if name}

    def pick(row: Dict[str, Any], *candidates: str) -> Optional[float]:
        for candidate in candidates:
            for lowered_key, original in lowered.items():
                if candidate in lowered_key:
                    value = row.get(original)
                    if value is None or value == "":
                        continue
                    try:
                        return float(value)
                    except (TypeError, ValueError):
                        continue
        return None

    for row in reader:
        t = pick(row, "time", "t", "elapsed")
        bt = pick(row, "bean", "bt", "temp")
        if t is None or bt is None:
            continue
        et = pick(row, "env", "et")
        point: Dict[str, Any] = {"t": int(t), "bt": bt}
        if et is not None:
            point["et"] = et
        points.append(point)

    if not points:
        warnings.append("未从 CSV 解析到数据行，请确认列名包含 time 与 bean temp")
    return points, warnings


def _decode_payload(payload: str) -> str:
    """payload 可能是纯文本或 base64。"""
    text = payload.strip()
    if "\n" in text or "\t" in text or text.startswith("#"):
        return text
    try:
        decoded = base64.b64decode(text, validate=True).decode("utf-8")
        return decoded
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return text


@bp.get("")
def list_roasts():
    """烘焙批次列表。"""
    query = scope(db.session.query(RoastBatch), RoastBatch)
    if request.args.get("beanId"):
        query = query.filter(RoastBatch.bean_id == request.args["beanId"])

    sort_fields = parse_sort(request.args.get("sort"), SORT_FIELDS, "roastDate")
    rows, next_cursor, has_more = paginate(
        query,
        model=RoastBatch,
        sort_fields=sort_fields,
        cursor=request.args.get("cursor"),
        limit=page_size(),
    )
    return ok(
        {"items": [r.to_dict() for r in rows]},
        pagination={"nextCursor": next_cursor, "hasMore": has_more, "limit": page_size()},
    )


@bp.post("")
def create_roast():
    """新建烘焙批次。"""
    data = parse_with(RoastCreateSchema())
    user = current_user()

    if db.session.get(Bean, data["beanId"]) is None:
        raise ValidationFailed("豆子不存在", details={"beanId": data["beanId"]}, field="beanId")

    roast = RoastBatch(
        id=new_id("rb"),
        user_id=user.id if user else None,
        bean_id=data["beanId"],
        batch_no=data["batchNo"],
        roaster=data.get("roaster"),
        green_grams=int(data.get("greenGrams") or 0),
        out_grams=int(data.get("outGrams") or 0),
        total_seconds=int(data.get("totalSeconds") or 0),
        events=data.get("events") or [],
        cupping_score=data.get("cuppingScore"),
        notes=data.get("notes"),
        roast_date=parse_datetime(data.get("roastDate"), name="roastDate") or utcnow(),
        target_profile_id=data.get("targetProfileId"),
    )
    points = data.get("curve") or []
    if points and not roast.events:
        # 有曲线但没有事件标记时，按曲线特征反推事件
        roast.events = roast_domain.infer_missing_events(points, roast.events)
    if not roast.total_seconds and roast.events:
        drop = next((e for e in roast.events if e["type"] == "drop"), None)
        if drop:
            roast.total_seconds = int(drop["atSecond"])
    if not points and roast.events:
        # 没有硬件数据时，用事件标记合成一条理论曲线
        points = roast_domain.generate_roast_curve(roast.events, roast.total_seconds)
    if points:
        _ensure_curve(roast, points, "live" if data.get("curve") else "keypoint")

    _recompute(roast)
    db.session.add(roast)
    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok(roast.to_dict(), status=201)


@bp.get("/<roast_id>")
def get_roast(roast_id: str):
    """烘焙详情（含曲线）。"""
    return ok(_get_roast(roast_id).to_dict())


@bp.patch("/<roast_id>")
def update_roast(roast_id: str):
    """更新烘焙批次。"""
    roast = _get_roast(roast_id)
    data = parse_with(RoastUpdateSchema(), partial=True)

    if "beanId" in data:
        if db.session.get(Bean, data["beanId"]) is None:
            raise ValidationFailed("豆子不存在", field="beanId")
        roast.bean_id = data["beanId"]
    if "batchNo" in data:
        roast.batch_no = data["batchNo"]
    if "roaster" in data:
        roast.roaster = data.get("roaster")
    if "greenGrams" in data:
        roast.green_grams = int(data.get("greenGrams") or 0)
    if "outGrams" in data:
        roast.out_grams = int(data.get("outGrams") or 0)
    if "totalSeconds" in data:
        roast.total_seconds = int(data.get("totalSeconds") or 0)
    if "events" in data:
        roast.events = data.get("events") or []
    if "cuppingScore" in data:
        roast.cupping_score = data.get("cuppingScore")
    if "notes" in data:
        roast.notes = data.get("notes")
    if "roastDate" in data:
        roast.roast_date = parse_datetime(data.get("roastDate"), name="roastDate") or roast.roast_date
    if "targetProfileId" in data:
        roast.target_profile_id = data.get("targetProfileId")

    _recompute(roast)

    if "curve" in data and data.get("curve"):
        _ensure_curve(roast, data["curve"], "live")
    elif roast.curve is None and roast.events:
        _ensure_curve(
            roast,
            roast_domain.generate_roast_curve(roast.events, roast.total_seconds),
            "keypoint",
        )

    db.session.commit()
    return ok(roast.to_dict())


@bp.delete("/<roast_id>")
def delete_roast(roast_id: str):
    """删除烘焙批次。"""
    roast = _get_roast(roast_id)
    db.session.delete(roast)
    db.session.commit()

    from ..services import cache

    cache.invalidate("stats")
    return ok({"ok": True})


@bp.post("/<roast_id>/events")
def append_event(roast_id: str):
    """追加事件打点（Charge/TP/DE/FC/Drop），并重算指标。"""
    roast = _get_roast(roast_id)
    body = request.get_json(silent=True) or {}

    event_type = body.get("type")
    if event_type not in roast_domain.__dict__.get("ROAST_EVENT_TYPES", ()) and event_type not in (
        "charge",
        "turningPoint",
        "dryEnd",
        "firstCrack",
        "drop",
    ):
        raise ValidationFailed(
            "未知的事件类型",
            details={"type": event_type},
            field="type",
        )
    try:
        at_second = int(body.get("atSecond"))
        temperature = float(body.get("temperature"))
    except (TypeError, ValueError):
        raise ValidationFailed("atSecond / temperature 必须为数值")

    events = list(roast.events or [])
    events = [e for e in events if e.get("type") != event_type]
    events.append({"type": event_type, "atSecond": at_second, "temperature": temperature})
    events.sort(key=lambda e: e["atSecond"])
    roast.events = events

    if not roast.total_seconds:
        drop = next((e for e in events if e["type"] == "drop"), None)
        roast.total_seconds = drop["atSecond"] if drop else at_second

    _recompute(roast)

    if roast.curve is None or roast.curve.source in ("keypoint", "import"):
        points = roast_domain.generate_roast_curve(roast.events, roast.total_seconds)
        _ensure_curve(roast, points, roast.curve.source if roast.curve else "keypoint")

    db.session.commit()
    return ok(roast.to_dict())


@bp.post("/import")
def import_roast():
    """导入烘焙曲线：Artisan .alog / CSV / Roest 分享链接。"""
    data = parse_with(RoastImportSchema())
    user = current_user()

    if db.session.get(Bean, data["beanId"]) is None:
        raise ValidationFailed("豆子不存在", details={"beanId": data["beanId"]}, field="beanId")

    fmt = data["format"]
    text = ""
    warnings: List[str] = []
    events: List[Dict[str, Any]] = []
    points: List[Dict[str, Any]] = []
    source = "import"

    if fmt == "roest_url":
        url = data.get("url")
        if not url:
            raise ValidationFailed("缺少分享链接", field="url")
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            text = resp.text
        except Exception as exc:
            raise ApiError(f"下载分享链接失败：{exc}", code="INTERNAL", status=502)
    else:
        payload = data.get("payload")
        if not payload:
            raise ValidationFailed("缺少文件内容", field="payload")
        text = _decode_payload(payload)

    if fmt in ("artisan_alog", "roest_url"):
        parsed = roast_domain.parse_artisan_alog(text)
        points = parsed["points"]
        events = parsed["events"]
        warnings = parsed["warnings"]
        if not points and fmt == "roest_url":
            points, csv_warnings = _parse_csv(text)
            warnings.extend(csv_warnings)
            source = "import"
    else:
        points, warnings = _parse_csv(text)

    if not points:
        raise ValidationFailed(
            "未能从文件中解析出曲线数据",
            details={"warnings": warnings},
            field="payload",
        )

    # 转成烘焙曲线点（含 RoR）
    curve_points: List[Dict[str, Any]] = []
    for point in points:
        t = int(point["t"])
        curve_points.append(
            {
                "t": t,
                "bt": round(float(point["bt"]), 1),
                "et": round(float(point["et"]), 1) if point.get("et") is not None else None,
            }
        )
    ror = roast_domain.compute_ror(
        [{"t": p["t"], "bt": p["bt"]} for p in curve_points]
    )
    for i, point in enumerate(curve_points):
        point["ror"] = ror[i] if i < len(ror) else 0

    total_seconds = curve_points[-1]["t"]
    # 缺标记时按温度阈值自动推断（DE ≈ 155℃ 转折、回温点取最低点）
    events = roast_domain.infer_missing_events(points, events)
    if events:
        drop = next((e for e in events if e["type"] == "drop"), None)
        if drop:
            total_seconds = max(total_seconds, int(drop["atSecond"]))

    roast = RoastBatch(
        id=new_id("rb"),
        user_id=user.id if user else None,
        bean_id=data["beanId"],
        batch_no=data.get("batchNo") or f"{utcnow():%Y-%m%d}-A",
        roaster=data.get("roaster"),
        green_grams=int(data.get("greenGrams") or 0),
        out_grams=int(data.get("outGrams") or 0),
        total_seconds=total_seconds,
        events=events,
        roast_date=utcnow(),
    )
    _recompute(roast)
    _ensure_curve(
        roast,
        curve_points,
        source,
        meta={
            "sourceFormat": "artisan-alog" if fmt == "artisan_alog" else fmt,
            "rorSmoothing": "30s-center",
        },
    )

    db.session.add(roast)
    db.session.commit()

    return ok(
        {
            "roastId": roast.id,
            "curveId": roast.curve.id if roast.curve else None,
            "parsed": {
                "points": len(curve_points),
                "events": [e["type"] for e in events],
            },
            "warnings": warnings,
            "roast": roast.to_dict(),
        },
        status=201,
    )


@bp.post("/compare")
def compare_roasts():
    """批次叠加对比。"""
    data = parse_with(CompareRoastsSchema())
    ids = data["roastIds"]
    roasts = scope(db.session.query(RoastBatch), RoastBatch).filter(RoastBatch.id.in_(ids)).all()
    ordered = [r for rid in ids for r in roasts if r.id == rid]

    metric_diff: List[Dict[str, Any]] = []
    for key, label in METRIC_LABELS.items():
        values = [getattr(r, "dtr_percent" if key == "dtrPercent" else key, None) for r in ordered]
        numeric = [v for v in values if isinstance(v, (int, float))]
        if len(numeric) == len(values) and len(set(numeric)) > 1:
            metric_diff.append(
                {
                    "field": key,
                    "label": label,
                    "values": values,
                    "delta": round(numeric[-1] - numeric[0], 2),
                }
            )

    curves = [
        {
            "id": r.id,
            "source": r.curve.source if r.curve else "keypoint",
            "points": (r.curve.points if r.curve else []) or [],
            "events": r.events or [],
        }
        for r in ordered
    ]

    return ok(
        {
            "roasts": [r.to_dict() for r in ordered],
            "metricDiff": metric_diff,
            "curves": curves,
        }
    )
