"""冲煮方式元数据

对应前端 ``src/domain/methods.ts``。

元数据来自 ``app/seed/methods.json``（由前端 ``src/domain/methods.ts`` 导出），
后端负责下发「方式 → 参数区间 / 风味基线 / 词库子类」的唯一权威口径，
前端启动时拉取并缓存，从而无需发版即可调参。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

__all__ = [
    "load_methods",
    "method_map",
    "find_method",
    "get_flavor_baseline",
    "calc_ratio",
    "validate_params",
]

_SEED_DIR = Path(__file__).resolve().parent.parent / "seed"


@lru_cache(maxsize=1)
def load_methods() -> List[Dict[str, Any]]:
    """加载全部冲煮方式元数据（进程内缓存）。"""
    path = _SEED_DIR / "methods.json"
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def method_map() -> Dict[str, Dict[str, Any]]:
    """id -> 方式元数据。"""
    return {m["id"]: m for m in load_methods()}


def find_method(id_or_alias: str) -> Optional[Dict[str, Any]]:
    """按 id 或别名查找方式；找不到返回 None。"""
    if not id_or_alias:
        return None
    key = id_or_alias.strip().lower()
    mapping = method_map()
    if key in mapping:
        return mapping[key]
    for m in load_methods():
        if m["id"].lower() == key:
            return m
        if any(a.lower() == key for a in m.get("aliases", [])):
            return m
    return None


def get_flavor_baseline(method_id: str) -> Dict[str, float]:
    """取方式的目标风味基线，找不到时给一个中性基线。"""
    method = method_map().get(method_id)
    if method:
        return dict(method["flavorBaseline"])
    return {
        "acidity": 5,
        "sweetness": 5,
        "body": 5,
        "flavor": 5,
        "aftertaste": 5,
        "balance": 5,
    }


def calc_ratio(dose_grams: float, water_grams: float) -> float:
    """粉水比（water / dose）。"""
    if not dose_grams:
        return 0
    return round(water_grams / dose_grams, 2)


def validate_params(
    method_id: str, params: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """参数越界检查：返回超出区间的字段。

    偏离区间 25% 以上视为 error，否则为 warn。
    """
    method = method_map().get(method_id)
    if not method:
        return []

    issues: List[Dict[str, Any]] = []
    for key, spec in method.get("params", {}).items():
        rng = spec.get("range")
        if not rng or spec.get("derived"):
            continue
        raw = params.get(key)
        if not isinstance(raw, (int, float)) or isinstance(raw, bool):
            continue
        low, high = rng[0], rng[1]
        if raw < low or raw > high:
            span = (high - low) or 1
            deviation = (low - raw) / span if raw < low else (raw - high) / span
            issues.append(
                {
                    "field": key,
                    "label": spec.get("label", key),
                    "value": raw,
                    "range": [low, high],
                    "severity": "error" if deviation > 0.25 else "warn",
                }
            )
    return issues
