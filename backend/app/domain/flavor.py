"""风味画像与 SCA 风味轮

对应前端 ``src/domain/flavor.ts``。

词库数据来自 ``app/seed/flavor_wheel.json``（由前端 ``src/domain/flavor.ts`` 导出，
避免两边维护两份词库导致漂移）。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from .compat import js_round

__all__ = [
    "FLAVOR_AXIS_KEYS",
    "FLAVOR_AXIS_LABELS",
    "TEMP_STAGE_LABELS",
    "load_flavor_wheel",
    "axes_delta",
    "match_score",
    "neutral_flavor",
    "descriptors_for_categories",
    "descriptor_index",
]

#: 六轴风味画像（对齐 SCA 核心属性 + 消费级简化六轴）
FLAVOR_AXIS_KEYS: List[str] = [
    "acidity",
    "sweetness",
    "body",
    "flavor",
    "aftertaste",
    "balance",
]

FLAVOR_AXIS_LABELS: Dict[str, str] = {
    "acidity": "酸质",
    "sweetness": "甜感",
    "body": "醇厚",
    "flavor": "风味",
    "aftertaste": "余韵",
    "balance": "平衡",
}

TEMP_STAGE_LABELS: Dict[str, str] = {
    "hot": "热（约 80℃+）",
    "warm": "温（70-75℃ · 最佳表达）",
    "cool": "凉（室温）",
}

_SEED_DIR = Path(__file__).resolve().parent.parent / "seed"


@lru_cache(maxsize=1)
def load_flavor_wheel() -> Dict[str, Any]:
    """加载 SCA 风味轮词库（进程内缓存）。"""
    path = _SEED_DIR / "flavor_wheel.json"
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def axes_delta(actual: Dict[str, float], baseline: Dict[str, float]) -> Dict[str, float]:
    """计算两套六轴的平均差值（实测 - 基线）。"""
    return {k: actual.get(k, 0) - baseline.get(k, 0) for k in FLAVOR_AXIS_KEYS}


def match_score(actual: Dict[str, float], baseline: Dict[str, float]) -> int:
    """吻合度 0-100：基线与实测的接近程度。"""
    diff = sum(abs(actual.get(k, 0) - baseline.get(k, 0)) for k in FLAVOR_AXIS_KEYS)
    # 平均每轴差 0 分 = 100 分，每轴差 5 分 ≈ 0 分
    avg = diff / len(FLAVOR_AXIS_KEYS)
    return max(0, min(100, js_round(100 - avg * 20)))


def neutral_flavor() -> Dict[str, float]:
    """中性风味画像。"""
    return {k: 5 for k in FLAVOR_AXIS_KEYS}


@lru_cache(maxsize=1)
def descriptor_index() -> Dict[str, Dict[str, str]]:
    """风味词扁平索引：id -> { label, category }。"""
    index: Dict[str, Dict[str, str]] = {}
    for category in load_flavor_wheel()["categories"]:
        for sub in category.get("subcategories", []):
            for d in sub.get("descriptors", []):
                index[d["id"]] = {"label": d["label"], "category": category["id"]}
    return index


def descriptors_for_categories(categories: List[str]) -> List[Dict[str, str]]:
    """按方式推荐的类别过滤词库。"""
    allow = set(categories)
    out: List[Dict[str, str]] = []
    for category in load_flavor_wheel()["categories"]:
        if category["id"] not in allow:
            continue
        for sub in category.get("subcategories", []):
            for d in sub.get("descriptors", []):
                out.append(
                    {
                        "id": d["id"],
                        "label": d["label"],
                        "category": category["id"],
                        "categoryLabel": category["label"],
                    }
                )
    return out
