"""养豆事件接口：``/api/v1/beans/{beanId}/rest-events``。

计划书第二节：
  - 事件类型支持开袋、密封或分装、养豆备注
  - 成品豆的事件挂购入批次（不传炉次）
  - 生豆的事件挂具体炉次（``roastBatchId`` 必填）
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict

from flask import Blueprint, request

from ..envelope import ok
from ..errors import NotFound, ValidationFailed
from ..extensions import db
from ..ids import new_id
from ..models.bean import Bean
from ..models.rest import RestEvent
from ..models.roast import RoastBatch
from ..schemas import RestEventCreateSchema, RestEventUpdateSchema
from ..security import current_user, ensure_owner
from ..services.validation import lock_bean_for_stock
from .helpers import parse_with, scope

bp = Blueprint("rest_events", __name__)


def _parse_occurred_at(raw: Any) -> datetime:
    """解析事件发生时刻，缺省为现在（UTC）。"""
    if not raw:
        from ..models.mixins import utcnow

        return utcnow()
    text = str(raw).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValidationFailed(
            "事件时间格式不正确", details={"occurredAt": raw}, field="occurredAt"
        ) from exc
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(tz=None).replace(tzinfo=None)
    return parsed


def _get_bean(bean_id: str) -> Bean:
    bean = db.session.get(Bean, bean_id)
    if bean is None:
        raise NotFound("豆子不存在")
    ensure_owner(bean, current_user())
    return bean


def _get_roast(roast_id: str, bean_id: str) -> RoastBatch:
    roast = db.session.get(RoastBatch, roast_id, with_for_update=True, populate_existing=True)
    if roast is None or roast.bean_id != bean_id:
        raise NotFound("烘焙批次不存在")
    ensure_owner(roast, current_user())
    return roast


def validate_rest_placement(bean: Bean, roast_batch_id: str | None) -> None:
    """校验事件挂载层级。

    - 生豆（kind=green）：必须带炉次，且该炉次已完成
    - 成品豆：不带炉次
    - 待确认类型需要先分类
    """
    if not bean.kind:
        raise ValidationFailed("请先确认豆子类型", field="beanId")
    if bean.kind == "green":
        if not roast_batch_id:
            raise ValidationFailed(
                "生豆的养豆事件需指定烘焙炉次",
                details={"roastBatchId": None},
                field="roastBatchId",
            )
        roast = _get_roast(roast_batch_id, bean.id)
        if not roast.is_completed():
            raise ValidationFailed(
                "该烘焙炉次尚未完成，不能登记养豆事件",
                details={"roastBatchId": roast_batch_id},
                field="roastBatchId",
            )
    elif roast_batch_id:
        raise ValidationFailed("成品豆养豆事件无需关联炉次", field="roastBatchId")


@bp.get("/<bean_id>/rest-events")
def list_rest_events(bean_id: str):
    """该豆的养豆事件（按发生时间倒序）。"""
    _get_bean(bean_id)
    rows = (
        scope(
            db.session.query(RestEvent).filter(RestEvent.bean_id == bean_id), RestEvent
        )
        .order_by(RestEvent.occurred_at.desc(), RestEvent.id.desc())
        .all()
    )
    return ok({"items": [r.to_dict() for r in rows]})


@bp.post("/<bean_id>/rest-events")
def create_rest_event(bean_id: str):
    """登记养豆事件。"""
    _get_bean(bean_id)
    bean = lock_bean_for_stock(bean_id)
    ensure_owner(bean, current_user())
    data = parse_with(RestEventCreateSchema())
    user = current_user()

    roast_batch_id = data.get("roastBatchId") or None
    validate_rest_placement(bean, roast_batch_id)

    event = RestEvent(
        id=new_id("re"),
        user_id=user.id if user else None,
        bean_id=bean.id,
        roast_batch_id=roast_batch_id,
        type=data["type"],
        occurred_at=_parse_occurred_at(data.get("occurredAt")),
        note=data.get("note"),
    )
    db.session.add(event)
    db.session.commit()
    return ok(event.to_dict(), status=201)


@bp.patch("/<bean_id>/rest-events/<event_id>")
def update_rest_event(bean_id: str, event_id: str):
    """更正养豆事件。"""
    _get_bean(bean_id)
    bean = lock_bean_for_stock(bean_id)
    ensure_owner(bean, current_user())
    event = db.session.get(RestEvent, event_id)
    if event is None or event.bean_id != bean_id:
        raise NotFound("养豆事件不存在")
    ensure_owner(event, current_user())

    data = parse_with(RestEventUpdateSchema(), partial=True)
    if "roastBatchId" in data:
        roast_batch_id = data.get("roastBatchId") or None
        validate_rest_placement(bean, roast_batch_id)
        event.roast_batch_id = roast_batch_id
    if "type" in data:
        event.type = data["type"]
    if "occurredAt" in data:
        event.occurred_at = _parse_occurred_at(data.get("occurredAt"))
    if "note" in data:
        event.note = data.get("note")
    db.session.commit()
    return ok(event.to_dict())


@bp.delete("/<bean_id>/rest-events/<event_id>")
def delete_rest_event(bean_id: str, event_id: str):
    """删除养豆事件。"""
    _get_bean(bean_id)
    event = db.session.get(RestEvent, event_id)
    if event is None or event.bean_id != bean_id:
        raise NotFound("养豆事件不存在")
    ensure_owner(event, current_user())
    db.session.delete(event)
    db.session.commit()
    return ok({"ok": True})
