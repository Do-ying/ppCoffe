"""器具接口：``/api/v1/equipment``。"""

from __future__ import annotations

from flask import Blueprint, request

from ..envelope import ok
from ..errors import NotFound
from ..extensions import db
from ..ids import new_id
from ..models.misc import Equipment
from ..schemas import EquipmentCreateSchema, EquipmentUpdateSchema
from ..security import current_user, ensure_owner
from .helpers import page_size, paginate, parse_sort, parse_with, scope

bp = Blueprint("equipment", __name__)

SORT_FIELDS = {
    "createdAt": Equipment.created_at,
    "updatedAt": Equipment.updated_at,
    "name": Equipment.name,
    "type": Equipment.type,
}


def _get_equipment(equipment_id: str) -> Equipment:
    equipment = db.session.get(Equipment, equipment_id)
    if equipment is None:
        raise NotFound("器具不存在")
    ensure_owner(equipment, current_user())
    return equipment


@bp.get("")
def list_equipment():
    """器具列表，按 type 分组返回。"""
    query = scope(db.session.query(Equipment), Equipment)
    if request.args.get("type"):
        query = query.filter(Equipment.type == request.args["type"])

    sort_fields = parse_sort(request.args.get("sort"), SORT_FIELDS, "createdAt")
    rows, next_cursor, has_more = paginate(
        query,
        model=Equipment,
        sort_fields=sort_fields,
        cursor=request.args.get("cursor"),
        limit=page_size(),
    )

    items = [e.to_dict() for e in rows]
    grouped: dict = {}
    for item in items:
        grouped.setdefault(item["type"], []).append(item)

    return ok(
        {"items": items, "groups": grouped},
        pagination={"nextCursor": next_cursor, "hasMore": has_more, "limit": page_size()},
    )


@bp.post("")
def create_equipment():
    """新增器具。"""
    data = parse_with(EquipmentCreateSchema())
    user = current_user()
    equipment = Equipment(
        id=new_id("eq"),
        user_id=user.id if user else None,
        type=data["type"],
        name=data["name"],
        brand=data.get("brand"),
        model=data.get("model"),
        notes=data.get("notes"),
    )
    db.session.add(equipment)
    db.session.commit()
    return ok(equipment.to_dict(), status=201)


@bp.get("/<equipment_id>")
def get_equipment(equipment_id: str):
    """器具详情。"""
    return ok(_get_equipment(equipment_id).to_dict())


@bp.patch("/<equipment_id>")
def update_equipment(equipment_id: str):
    """更新器具。"""
    equipment = _get_equipment(equipment_id)
    data = parse_with(EquipmentUpdateSchema(), partial=True)
    if "type" in data:
        equipment.type = data["type"]
    if "name" in data:
        equipment.name = data["name"]
    if "brand" in data:
        equipment.brand = data.get("brand")
    if "model" in data:
        equipment.model = data.get("model")
    if "notes" in data:
        equipment.notes = data.get("notes")
    db.session.commit()
    return ok(equipment.to_dict())


@bp.delete("/<equipment_id>")
def delete_equipment(equipment_id: str):
    """删除器具（不影响历史记录）。"""
    equipment = _get_equipment(equipment_id)
    db.session.delete(equipment)
    db.session.commit()
    return ok({"ok": True})
