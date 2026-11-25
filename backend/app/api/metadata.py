"""元数据接口：``/api/v1/methods``、``/flavor-wheel``、``/roast-phases``。

这些数据是前端「方式联动风味」的基础，启动时拉取并缓存，
由后端下发而非写死在前端，便于调参且无需发版。
"""

from __future__ import annotations

from flask import Blueprint, current_app

from ..domain import roast as roast_domain
from ..domain.flavor import load_flavor_wheel
from ..domain.methods import load_methods
from ..envelope import ok
from ..services import cache

bp = Blueprint("metadata", __name__)


@bp.get("/methods")
def list_methods():
    """冲煮方式元数据（参数区间 + 风味基线 + 默认注水计划）。"""
    ttl = current_app.config.get("CACHE_TTL_METADATA", 3600)
    items = cache.cached("methods", "all", load_methods, ttl)
    return ok({"items": items})


@bp.get("/flavor-wheel")
def flavor_wheel():
    """SCA 风味轮词库。"""
    ttl = current_app.config.get("CACHE_TTL_METADATA", 3600)
    data = cache.cached("flavor-wheel", "all", load_flavor_wheel, ttl)
    return ok(data)


@bp.get("/roast-phases")
def roast_phases():
    """烘焙阶段定义与阈值。"""
    ttl = current_app.config.get("CACHE_TTL_METADATA", 3600)
    data = cache.cached(
        "roast-phases",
        "all",
        lambda: {
            "phases": [
                {
                    "id": "drying",
                    "label": roast_domain.ROAST_PHASE_LABELS["drying"],
                    "description": "脱水期：豆温排出水分，RoR 起始高后回落",
                    "typicalRatio": [35, 45],
                    "temperatureRange": [80, 160],
                    "tips": "投豆后 RoR 冲到 20-25℃/min，随后平缓下降",
                },
                {
                    "id": "maillard",
                    "label": roast_domain.ROAST_PHASE_LABELS["maillard"],
                    "description": "梅纳反应期：香气前体大量生成，RoR 平稳下降",
                    "typicalRatio": [40, 50],
                    "temperatureRange": [150, 200],
                    "tips": "出现 crash（RoR 骤降 >3℃/min）容易 underdeveloped",
                },
                {
                    "id": "development",
                    "label": roast_domain.ROAST_PHASE_LABELS["development"],
                    "description": "发展期：一爆到下豆，决定风味结构与焦苦程度",
                    "typicalRatio": [10, 16],
                    "temperatureRange": [196, 220],
                    "tips": "发展比（DTR）建议 15%-20%，过长会焦糊",
                },
            ],
            "events": [
                {"type": "charge", "label": "投豆"},
                {"type": "turningPoint", "label": "回温点"},
                {"type": "dryEnd", "label": "脱水结束"},
                {"type": "firstCrack", "label": "一爆"},
                {"type": "drop", "label": "下豆"},
            ],
            "rorHealthyShape": {
                "early": [15, 25],
                "maillard": "平稳下降",
                "beforeFirstCrack": [5, 15],
                "unit": "°C/min",
            },
            "typicalRatio": {
                "drying": 40,
                "maillard": 46,
                "development": 13,
            },
        },
        ttl,
    )
    return ok(data)
