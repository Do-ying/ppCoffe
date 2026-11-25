"""豆子接口：``/api/v1/beans``。"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List

from flask import Blueprint, request
from sqlalchemy import or_

from ..domain.flavor import FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS
from ..envelope import ok
from ..errors import Conflict, NotFound
from ..extensions import db
from ..ids import new_id
from ..models.bean import Bean
from ..models.brew import BrewRecord
from ..models.roast import RoastBatch
from ..schemas import BeanCreateSchema, BeanUpdateSchema
from ..security import current_user, ensure_owner
from .helpers import page_size, paginate, parse_date, parse_sort, parse_with, scope

bp = Blueprint("beans", __name__)

SORT_FIELDS = {
    "roastDate": Bean.roast_date,
    "createdAt": Bean.created_at,
    "updatedAt": Bean.updated_at,
    "name": Bean.name,
    "remainingGrams": Bean.remaining_grams,
}


def _apply_fields(bean: Bean, data: Dict[str, Any]) -> None:
    if "name" in data:
        bean.name = data["name"]
    if "roaster" in data:
        bean.roaster = data.get("roaster")
    if "origin" in data:
        bean.origin = data.get("origin")
    if "process" in data:
        bean.process = data.get("process")
    if "roastLevel" in data:
        bean.roast_level = data.get("roastLevel")
    if "agtron" in data:
        bean.agtron = data.get("agtron")
    if "roastDate" in data:
        bean.roast_date = parse_date(data.get("roastDate"), name="roastDate")
    if "weightGrams" in data:
        bean.weight_grams = int(data.get("weightGrams") or 0)
    if "remainingGrams" in data:
        bean.remaining_grams = int(data.get("remainingGrams") or 0)
    if "tags" in data:
        bean.tags = data.get("tags") or []
    if "imageUrl" in data:
        bean.image_url = data.get("imageUrl")
    if "notes" in data:
        bean.notes = data.get("notes")


def _get_bean(bean_id: str) -> Bean:
    bean = db.session.get(Bean, bean_id)
    if bean is None:
        raise NotFound("豆子不存在")
    ensure_owner(bean, current_user())
    return bean


@bp.get("")
def list_beans():
    """豆子列表（游标分页）。"""
    query = scope(db.session.query(Bean), Bean)

    keyword = request.args.get("q")
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(Bean.name.like(like), Bean.roaster.like(like), Bean.notes.like(like))
        )
    if request.args.get("roastLevel"):
        query = query.filter(Bean.roast_level == request.args["roastLevel"])
    if request.args.get("process"):
        query = query.filter(Bean.process == request.args["process"])
    if request.args.get("tag"):
        query = query.filter(Bean.tags.like(f"%{request.args['tag']}%"))

    sort_fields = parse_sort(request.args.get("sort"), SORT_FIELDS, "createdAt")
    rows, next_cursor, has_more = paginate(
        query,
        model=Bean,
        sort_fields=sort_fields,
        cursor=request.args.get("cursor"),
        limit=page_size(),
    )
    return ok(
        {"items": [b.to_dict() for b in rows]},
        pagination={"nextCursor": next_cursor, "hasMore": has_more, "limit": page_size()},
    )


@bp.post("")
def create_bean():
    """新建豆子。"""
    data = parse_with(BeanCreateSchema())
    user = current_user()
    bean = Bean(id=new_id("bn"), user_id=user.id if user else None)
    _apply_fields(bean, data)
    if bean.roast_date is None:
        bean.roast_date = date.today()
    db.session.add(bean)
    db.session.commit()
    return ok(bean.to_dict(), status=201)


@bp.get("/<bean_id>")
def get_bean(bean_id: str):
    """豆子详情。"""
    return ok(_get_bean(bean_id).to_dict())


@bp.patch("/<bean_id>")
def update_bean(bean_id: str):
    """更新豆子。"""
    bean = _get_bean(bean_id)
    data = parse_with(BeanUpdateSchema(), partial=True)
    _apply_fields(bean, data)
    db.session.commit()
    return ok(bean.to_dict())


@bp.delete("/<bean_id>")
def delete_bean(bean_id: str):
    """删除豆子（级联删除其下的冲煮与烘焙记录）。"""
    bean = _get_bean(bean_id)
    db.session.delete(bean)
    db.session.commit()
    return ok({"ok": True})


@bp.get("/<bean_id>/brews")
def bean_brews(bean_id: str):
    """该豆的冲煮记录。"""
    _get_bean(bean_id)
    query = scope(
        db.session.query(BrewRecord).filter(BrewRecord.bean_id == bean_id), BrewRecord
    )
    query = query.order_by(BrewRecord.brew_date.desc(), BrewRecord.id.desc())
    rows = query.all()
    return ok({"items": [b.to_dict() for b in rows]})


@bp.get("/<bean_id>/roasts")
def bean_roasts(bean_id: str):
    """该豆的烘焙批次。"""
    _get_bean(bean_id)
    query = scope(
        db.session.query(RoastBatch).filter(RoastBatch.bean_id == bean_id), RoastBatch
    )
    query = query.order_by(RoastBatch.roast_date.desc(), RoastBatch.id.desc())
    rows = query.all()
    return ok({"items": [r.to_dict() for r in rows]})


@bp.get("/<bean_id>/trend")
def bean_trend(bean_id: str):
    """该豆的风味趋势（按冲煮日期聚合六轴均值）。"""
    _get_bean(bean_id)
    query = scope(
        db.session.query(BrewRecord).filter(BrewRecord.bean_id == bean_id), BrewRecord
    )
    rows = query.order_by(BrewRecord.brew_date.asc()).all()

    buckets: Dict[str, Dict[str, List[float]]] = {}
    samples: List[Dict[str, Any]] = []
    for brew in rows:
        flavor = brew.flavor or {}
        axes = flavor.get("axes") or {}
        if not axes:
            continue
        day = (brew.brew_date.isoformat() if brew.brew_date else "")[:10]
        bucket = buckets.setdefault(day, {axis: [] for axis in FLAVOR_AXIS_KEYS})
        for axis in FLAVOR_AXIS_KEYS:
            if axis in axes:
                bucket[axis].append(float(axes[axis]))
        samples.append(
            {
                "x": day,
                "brewId": brew.id,
                "roastBatchId": brew.roast_batch_id,
                "overall": flavor.get("overall"),
            }
        )

    x_axis = sorted(buckets.keys())
    series = [
        {
            "name": FLAVOR_AXIS_LABELS[axis],
            "axis": axis,
            "values": [
                round(sum(buckets[day][axis]) / len(buckets[day][axis]), 2) if buckets[day][axis] else None
                for day in x_axis
            ],
        }
        for axis in FLAVOR_AXIS_KEYS
    ]
    return ok({"x": x_axis, "series": series, "samples": samples})
