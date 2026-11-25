"""统计接口：``/api/v1/stats``。"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

from flask import Blueprint, request

from ..domain.flavor import FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS
from ..domain.rest import rest_stage_info
from ..envelope import ok
from ..extensions import db
from ..models.bean import Bean
from ..models.brew import BrewRecord
from ..models.mixins import utcnow
from ..models.roast import RoastBatch
from ..security import current_user
from ..services import cache
from .helpers import scope

bp = Blueprint("stats", __name__)


@bp.get("/summary")
def summary():
    """首页汇总：今日/本周统计 + 养豆提醒。"""
    def build() -> Dict[str, Any]:
        now = utcnow()
        today_str = now.strftime("%Y-%m-%d")
        week_ago = now - timedelta(days=7)

        brews = scope(db.session.query(BrewRecord), BrewRecord).all()
        roasts = scope(db.session.query(RoastBatch), RoastBatch).all()
        beans = scope(db.session.query(Bean), Bean).all()

        today_brews = [b for b in brews if b.brew_date and b.brew_date.strftime("%Y-%m-%d") == today_str]
        today_roasts = [r for r in roasts if r.roast_date and r.roast_date.strftime("%Y-%m-%d") == today_str]
        week_brews = [b for b in brews if b.brew_date and b.brew_date >= week_ago]

        def avg_overall(items: List[BrewRecord]) -> float:
            values = [
                float((b.flavor or {}).get("overall") or 0)
                for b in items
                if (b.flavor or {}).get("overall") is not None
            ]
            return round(sum(values) / len(values), 1) if values else 0

        by_method: Dict[str, int] = {}
        for brew in week_brews:
            by_method[brew.method] = by_method.get(brew.method, 0) + 1

        resting_beans = []
        roasts_by_bean: Dict[str, List[RoastBatch]] = {}
        for roast in roasts:
            if roast.is_completed():
                roasts_by_bean.setdefault(roast.bean_id, []).append(roast)
        for bean in beans:
            sources = (
                [(r.roast_date, r.id, r.batch_no) for r in roasts_by_bean.get(bean.id, [])]
                if bean.kind == "green" else [(bean.roast_date, None, None)]
            )
            for roast_date, roast_id, batch_no in sources:
                stage = rest_stage_info(roast_date, now.date())
                if stage["roastDate"] is None:
                    continue
                resting_beans.append({
                    "beanId": bean.id,
                    "name": bean.name,
                    "roastDate": stage["roastDate"],
                    "daysSinceRoast": stage["days"],
                    "stage": stage["stage"],
                    **({"roastBatchId": roast_id, "batchNo": batch_no} if roast_id else {}),
                })
        resting_beans.sort(key=lambda row: row["roastDate"], reverse=True)

        return {
            "today": {
                "brewCount": len(today_brews),
                "roastCount": len(today_roasts),
                "avgFlavor": avg_overall(today_brews),
            },
            "week": {
                "brewCount": len(week_brews),
                "avgFlavor": avg_overall(week_brews),
                "byMethod": by_method,
            },
            "restingBeans": resting_beans,
            "activeSession": None,
        }

    user = current_user()
    key = f"summary:{user.id if user else 'anonymous'}"
    data = cache.cached("stats", key, build, 60)
    return ok(data)


@bp.get("/trends")
def trends():
    """趋势分析：风味随烘焙日期变化 / 参数漂移。"""
    bean_id = request.args.get("beanId")
    metric = request.args.get("metric", "flavor")
    group_by = request.args.get("groupBy", "roastDate")

    query = scope(db.session.query(BrewRecord), BrewRecord)
    if bean_id:
        query = query.filter(BrewRecord.bean_id == bean_id)
    rows = query.order_by(BrewRecord.brew_date.asc()).all()

    bean_map = {
        b.id: b
        for b in scope(db.session.query(Bean), Bean).all()
    }
    roast_map = {r.id: r for r in scope(db.session.query(RoastBatch), RoastBatch).all()}

    buckets: Dict[str, Dict[str, List[float]]] = {}
    samples: List[Dict[str, Any]] = []
    for brew in rows:
        axes = (brew.flavor or {}).get("axes") or {}
        if group_by == "roastDate":
            bean = bean_map.get(brew.bean_id)
            roast = roast_map.get(brew.roast_batch_id)
            roast_date = roast.roast_date.date() if roast and roast.bean_id == brew.bean_id else (
                bean.roast_date if bean else None
            )
            x = roast_date.isoformat() if roast_date else (
                brew.brew_date.strftime("%Y-%m-%d") if brew.brew_date else ""
            )
        else:
            x = brew.brew_date.strftime("%Y-%m-%d") if brew.brew_date else ""
        bucket = buckets.setdefault(x, {axis: [] for axis in FLAVOR_AXIS_KEYS})
        for axis in FLAVOR_AXIS_KEYS:
            if axis in axes:
                bucket[axis].append(float(axes[axis]))
        samples.append(
            {
                "x": x,
                "brewId": brew.id,
                "roastBatchId": brew.roast_batch_id,
                "method": brew.method,
                "ratio": (brew.params or {}).get("ratio"),
            }
        )

    x_axis = sorted(buckets.keys())
    series = [
        {
            "name": FLAVOR_AXIS_LABELS[axis],
            "axis": axis,
            "values": [
                round(sum(buckets[day][axis]) / len(buckets[day][axis]), 2)
                if buckets[day][axis]
                else None
                for day in x_axis
            ],
        }
        for axis in FLAVOR_AXIS_KEYS
    ]

    # 参数漂移：粉水比 / 萃取时间随时间的变化
    drift = []
    for brew in rows:
        params = brew.params or {}
        if params.get("ratio") is None and params.get("doseGrams") and params.get("waterGrams"):
            params = {**params, "ratio": round(params["waterGrams"] / params["doseGrams"], 2)}
        drift.append(
            {
                "x": brew.brew_date.strftime("%Y-%m-%d") if brew.brew_date else "",
                "brewId": brew.id,
                "ratio": params.get("ratio"),
                "brewSeconds": params.get("brewSeconds"),
                "overall": (brew.flavor or {}).get("overall"),
            }
        )

    return ok({"x": x_axis, "series": series, "samples": samples, "metric": metric, "drift": drift})
