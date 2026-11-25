"""豆子接口：``/api/v1/beans``。"""

from __future__ import annotations

from typing import Any, Dict, List

from flask import Blueprint, request
from sqlalchemy import or_

from ..domain.flavor import FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS
from ..envelope import ok
from ..errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..extensions import db
from ..ids import new_id
from ..models.bean import Bean
from ..models.brew import BrewRecord
from ..models.misc import Upload
from ..models.rest import RestEvent
from ..models.roast import RoastBatch
from ..schemas import BeanCreateSchema, BeanUpdateSchema
from ..security import current_user, ensure_owner
from ..services import cache
from ..services.validation import lock_bean_for_stock, used_green_grams
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
    if "kind" in data:
        bean.kind = data.get("kind")
    if "purchaseCostCents" in data:
        bean.purchase_cost_cents = data.get("purchaseCostCents")
    if "sourceFileKey" in data:
        bean.source_file_key = data.get("sourceFileKey")
        if not bean.source_file_key and "imageUrl" not in data:
            bean.image_url = None
    if bean.kind == "green" and ("kind" in data or {"roastLevel", "roastDate"} & data.keys()):
        bean.roast_level = None
        bean.roast_date = None


def _get_bean(bean_id: str) -> Bean:
    bean = db.session.get(Bean, bean_id)
    if bean is None:
        raise NotFound("豆子不存在")
    ensure_owner(bean, current_user())
    return bean


def _bean_roasts(bean_id: str) -> List[RoastBatch]:
    """该豆下的炉次（按用户范围过滤）。"""
    return scope(
        db.session.query(RoastBatch).filter(RoastBatch.bean_id == bean_id), RoastBatch
    ).all()


def _bean_payload(bean: Bean) -> Dict[str, Any]:
    """豆子的完整响应：基础字段 + 库存汇总 + 每克成本 + 养豆阶段。"""
    from ..domain.rest import rest_stage_info
    from ..services.stock import bean_rest_anchor_date, summarize_bean_stock

    roasts = _bean_roasts(bean.id)
    data = bean.to_dict()
    data.update(summarize_bean_stock(bean, roasts))

    # 养豆阶段：成品豆用豆子上的烘焙日期，生豆用最近一炉的烘焙日期
    data["restStage"] = rest_stage_info(bean_rest_anchor_date(bean, roasts))
    return data


def _validate_bean_kind(bean: Bean, data: Dict[str, Any]) -> None:
    """类型相关校验。

    规则（计划书第二节）：
    - 新增豆子必须明确类型
    - 已确认类型且已有业务记录时，普通编辑锁定类型
    - 成品豆的烘焙日期 / 烘焙度可留空；生豆在这层留空
    """
    if "kind" not in data:
        return

    new_kind = data.get("kind")
    if new_kind not in (None, "purchased_roasted", "green"):
        raise ValidationFailed(
            "豆子类型无效", details={"kind": new_kind}, field="kind"
        )

    old_kind = bean.kind
    # 已有业务记录时锁定类型（避免改变历史记录与库存的含义）
    if old_kind and new_kind != old_kind:
        has_roasts = bool(_bean_roasts(bean.id))
        has_brews = bool(
            scope(
                db.session.query(BrewRecord).filter(BrewRecord.bean_id == bean.id),
                BrewRecord,
            ).count()
        )
        has_rest_events = db.session.query(RestEvent.id).filter_by(bean_id=bean.id).first()
        if has_roasts or has_brews or has_rest_events:
            raise Conflict(
                "该豆子已有烘焙或冲煮记录，不能更改类型",
                details={"kind": old_kind},
            )

    bean.kind = new_kind


def _validate_bean_quantity(bean: Bean, data: Dict[str, Any]) -> None:
    """购入克数校验：新购入批次的重量必须大于零。"""
    if "weightGrams" in data:
        grams = int(data.get("weightGrams") or 0)
        if grams <= 0:
            raise ValidationFailed(
                "购入克数必须大于零", details={"weightGrams": grams}, field="weightGrams"
            )
    if bean.kind == "green" and {"kind", "weightGrams"} & data.keys():
        if used_green_grams(bean.id) > bean.weight_grams:
            raise Conflict("购入克数不能小于已使用的生豆克数")


def _validate_source_file_key(data: Dict[str, Any]) -> None:
    """封面对象键必须对应当前用户的上传记录。

    计划书第五节：「后端复用豆子的 ``source_file_key`` 保存对象键，
    校验该键对应当前用户的上传记录」。
    """
    object_key = data.get("sourceFileKey")
    if not object_key:
        return

    upload = db.session.query(Upload).filter(Upload.object_key == object_key).first()
    if upload is None:
        raise ValidationFailed(
            "图片不存在或已失效",
            details={"sourceFileKey": object_key},
            field="sourceFileKey",
        )
    user = current_user()
    if upload.user_id != (user.id if user else None):
        raise Forbidden("无权使用该图片")


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
        {"items": [_bean_payload(b) for b in rows]},
        pagination={"nextCursor": next_cursor, "hasMore": has_more, "limit": page_size()},
    )


@bp.post("")
def create_bean():
    """新建豆子（一条记录 = 一个购入批次）。"""
    data = parse_with(BeanCreateSchema())
    user = current_user()
    bean = Bean(id=new_id("bn"), user_id=user.id if user else None)
    _validate_bean_kind(bean, data)
    if bean.kind is None:
        raise ValidationFailed("请选择豆子类型", field="kind")
    if "weightGrams" not in data:
        raise ValidationFailed("请输入购入克数", field="weightGrams")
    _apply_fields(bean, data)
    _validate_bean_quantity(bean, data)
    _validate_source_file_key(data)
    db.session.add(bean)
    db.session.commit()
    cache.invalidate("stats")
    return ok(_bean_payload(bean), status=201)


@bp.get("/<bean_id>")
def get_bean(bean_id: str):
    """豆子详情。"""
    return ok(_bean_payload(_get_bean(bean_id)))


@bp.patch("/<bean_id>")
def update_bean(bean_id: str):
    """更新豆子。"""
    _get_bean(bean_id)
    bean = lock_bean_for_stock(bean_id)
    ensure_owner(bean, current_user())
    data = parse_with(BeanUpdateSchema(), partial=True)
    _validate_bean_kind(bean, data)
    _validate_source_file_key(data)
    _apply_fields(bean, data)
    _validate_bean_quantity(bean, data)
    db.session.commit()
    cache.invalidate("stats")
    return ok(_bean_payload(bean))


@bp.delete("/<bean_id>")
def delete_bean(bean_id: str):
    """删除豆子（级联删除其下的冲煮与烘焙记录）。"""
    bean = _get_bean(bean_id)
    db.session.delete(bean)
    db.session.commit()
    cache.invalidate("stats")
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
