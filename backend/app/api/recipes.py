"""配方接口：``/api/v1/recipes``。"""

from __future__ import annotations

from flask import Blueprint, request

from ..envelope import ok
from ..errors import NotFound
from ..extensions import db
from ..ids import new_id
from ..models.misc import Recipe
from ..schemas import RecipeCreateSchema, RecipeUpdateSchema
from ..security import current_user, ensure_owner
from .helpers import page_size, paginate, parse_sort, parse_with, scope

bp = Blueprint("recipes", __name__)

SORT_FIELDS = {
    "createdAt": Recipe.created_at,
    "updatedAt": Recipe.updated_at,
    "name": Recipe.name,
    "method": Recipe.method,
}


def _get_recipe(recipe_id: str) -> Recipe:
    recipe = db.session.get(Recipe, recipe_id)
    if recipe is None:
        raise NotFound("配方不存在")
    ensure_owner(recipe, current_user())
    return recipe


@bp.get("")
def list_recipes():
    """配方列表。"""
    query = scope(db.session.query(Recipe), Recipe)
    if request.args.get("method"):
        query = query.filter(Recipe.method == request.args["method"])
    if request.args.get("favorite"):
        query = query.filter(Recipe.favorite.is_(True))

    sort_fields = parse_sort(request.args.get("sort"), SORT_FIELDS, "createdAt")
    rows, next_cursor, has_more = paginate(
        query,
        model=Recipe,
        sort_fields=sort_fields,
        cursor=request.args.get("cursor"),
        limit=page_size(),
    )
    return ok(
        {"items": [r.to_dict() for r in rows]},
        pagination={"nextCursor": next_cursor, "hasMore": has_more, "limit": page_size()},
    )


@bp.post("")
def create_recipe():
    """新建配方。"""
    data = parse_with(RecipeCreateSchema())
    user = current_user()
    recipe = Recipe(
        id=new_id("rc"),
        user_id=user.id if user else None,
        name=data["name"],
        method=data["method"],
        params=data.get("params") or {},
        steps=data.get("steps") or [],
        notes=data.get("notes"),
        favorite=bool(data.get("favorite")),
    )
    db.session.add(recipe)
    db.session.commit()
    return ok(recipe.to_dict(), status=201)


@bp.get("/<recipe_id>")
def get_recipe(recipe_id: str):
    """配方详情。"""
    return ok(_get_recipe(recipe_id).to_dict())


@bp.patch("/<recipe_id>")
def update_recipe(recipe_id: str):
    """更新配方。"""
    recipe = _get_recipe(recipe_id)
    data = parse_with(RecipeUpdateSchema(), partial=True)
    if "name" in data:
        recipe.name = data["name"]
    if "method" in data:
        recipe.method = data["method"]
    if "params" in data:
        recipe.params = data.get("params") or {}
    if "steps" in data:
        recipe.steps = data.get("steps") or []
    if "notes" in data:
        recipe.notes = data.get("notes")
    if "favorite" in data:
        recipe.favorite = bool(data.get("favorite"))
    db.session.commit()
    return ok(recipe.to_dict())


@bp.delete("/<recipe_id>")
def delete_recipe(recipe_id: str):
    """删除配方。"""
    recipe = _get_recipe(recipe_id)
    db.session.delete(recipe)
    db.session.commit()
    return ok({"ok": True})
