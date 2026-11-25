"""冲煮曲线生成

对应前端 ``src/domain/curve/generate.ts``。

三种来源统一抽象为 ``CurveSource``：

* ``plan``     —— 由注水计划生成理论曲线（无需硬件）
* ``keypoint`` —— 用户在计时中打的关键点，插值补全
* ``device``   —— 蓝牙秤 / CSV 采集到的原始序列（清洗 + 流速计算）

本文件是纯函数层，不依赖 Flask / SQLAlchemy。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from .compat import js_round, js_to_fixed
from .interpolate import KeyPoint, smooth_curve

__all__ = [
    "STAGE_LABELS",
    "derive_stages",
    "stage_at",
    "compute_flow",
    "generate_plan_curve",
    "generate_keypoint_curve",
    "clean_device_curve",
    "curve_stats",
]

#: 闷蒸/首段注水的实际注水动作时长（秒）
POUR_DURATION = 8

STAGE_LABELS: Dict[str, str] = {
    "preinfusion": "预浸",
    "bloom": "闷蒸",
    "extraction": "萃取",
    "drawdown": "滴滤",
}


def derive_stages(steps: Sequence[Dict[str, Any]], total_seconds: float) -> List[Dict[str, Any]]:
    """由注水计划推导阶段区间。"""
    if not steps:
        return []
    spans: List[Dict[str, Any]] = []
    first = steps[0]
    second = steps[1] if len(steps) > 1 else None

    if second:
        spans.append(
            {"from": 0, "to": second["atSecond"], "label": first["label"], "stage": first["stage"]}
        )
        for i in range(1, len(steps) - 1):
            spans.append(
                {
                    "from": steps[i]["atSecond"],
                    "to": steps[i + 1]["atSecond"],
                    "label": steps[i]["label"],
                    "stage": steps[i]["stage"],
                }
            )
        last = steps[-1]
        spans.append(
            {
                "from": last["atSecond"],
                "to": max(last["atSecond"], total_seconds),
                "label": last["label"],
                "stage": last["stage"],
            }
        )
    else:
        spans.append(
            {
                "from": 0,
                "to": max(first["atSecond"], total_seconds),
                "label": first["label"],
                "stage": first["stage"],
            }
        )
    return spans


def stage_at(stages: Sequence[Dict[str, Any]], t: float) -> str:
    """根据时间戳判定所处阶段。"""
    for s in stages:
        if s["from"] <= t <= s["to"]:
            return s["stage"]
    return stages[-1]["stage"] if stages else "extraction"


def _kp(point: Any) -> KeyPoint:
    """把关键点统一成 ``(t, w)``。

    兼容前端传入的 ``{"t": 12, "w": 32}`` 与内部的 ``(t, w)`` 元组。
    """
    if isinstance(point, dict):
        return (float(point["t"]), float(point["w"]))
    return (float(point[0]), float(point[1]))


def compute_flow(points: Sequence[Any], window: int = 3) -> List[float]:
    """瞬时流速（克/秒）。

    对累计重量做差分，再用滑动平均抹掉称重抖动。
    """
    pts = [_kp(p) for p in points]
    raw: List[float] = []
    for i in range(len(pts)):
        if i == 0:
            raw.append(0.0)
            continue
        prev = pts[i - 1]
        dt = pts[i][0] - prev[0]
        raw.append(max(0.0, (pts[i][1] - prev[1]) / dt) if dt > 0 else 0.0)

    if window <= 1:
        return raw

    smoothed: List[float] = []
    half = window // 2
    n = len(raw)
    for i in range(n):
        total = 0.0
        count = 0
        for j in range(max(0, i - half), min(n - 1, i + half) + 1):
            total += raw[j]
            count += 1
        smoothed.append(total / count if count else 0.0)
    return smoothed


def _to_points(
    smoothed: Sequence[KeyPoint], flows: Sequence[float], stages: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    for i, (t, w) in enumerate(smoothed):
        points.append(
            {
                "t": js_round(t),
                "w": js_to_fixed(w, 2),
                "flow": js_to_fixed(flows[i] if i < len(flows) else 0.0, 3),
                "stage": stage_at(stages, t),
            }
        )
    return points


def generate_plan_curve(
    steps: Sequence[Dict[str, Any]], total_seconds: float
) -> Dict[str, Any]:
    """由注水计划生成理论曲线。"""
    stages = derive_stages(steps, total_seconds)
    keypoints: List[KeyPoint] = [(0.0, 0.0)]

    for i, s in enumerate(steps):
        if i == 0 and s["atSecond"] == 0:
            # 首段是一次快速注水动作，用 POUR_DURATION 表现这段上升
            nxt = steps[1] if len(steps) > 1 else None
            end = min(POUR_DURATION, max(1, nxt["atSecond"] - 1) if nxt else POUR_DURATION)
            keypoints.append((float(end), float(s["toGrams"])))
        else:
            keypoints.append((float(s["atSecond"]), float(s["toGrams"])))

    last = keypoints[-1]
    if total_seconds > last[0]:
        keypoints.append((float(total_seconds), last[1]))

    smoothed = smooth_curve(keypoints, 1)
    flows = compute_flow(smoothed)

    return {
        "source": "plan",
        "points": _to_points(smoothed, flows, stages),
        "stages": stages,
    }


def generate_keypoint_curve(
    keypoints: Sequence[Sequence[float]],
    stages: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """由关键点生成曲线。"""
    if not keypoints:
        return {"source": "keypoint", "points": [], "stages": []}

    ordered = sorted((_kp(k) for k in keypoints), key=lambda p: p[0])
    total = ordered[-1][0]
    spans = list(stages) if stages else derive_stages_from_keypoints(ordered, total)
    smoothed = smooth_curve(ordered, 1)
    flows = compute_flow(smoothed)

    return {
        "source": "keypoint",
        "points": _to_points(smoothed, flows, spans),
        "stages": spans,
    }


def derive_stages_from_keypoints(
    ordered: Sequence[KeyPoint], total: float
) -> List[Dict[str, Any]]:
    """无注水计划时，按关键点均分阶段。"""
    if len(ordered) < 2:
        return [{"from": 0, "to": total, "label": "萃取", "stage": "extraction"}]
    seg = max(1, (len(ordered) - 1) // 2)
    mid = ordered[seg][0]
    return [
        {"from": 0, "to": mid, "label": "闷蒸", "stage": "bloom"},
        {"from": mid, "to": total, "label": "萃取", "stage": "extraction"},
    ]


def clean_device_curve(raw: Sequence[Sequence[float]]) -> Dict[str, Any]:
    """清洗设备采集的原始序列。

    :param raw: 原始 (t 秒, w 克)
    """
    ordered = sorted((_kp(p) for p in raw), key=lambda p: p[0])

    # 去掉累计重量倒退的噪点（称重抖动）
    cleaned: List[KeyPoint] = []
    last_w = float("-inf")
    for p in ordered:
        if p[1] >= last_w:
            cleaned.append(p)
            last_w = p[1]

    stages = derive_stages_from_keypoints(cleaned, cleaned[-1][0] if cleaned else 0)
    flows = compute_flow(cleaned, 5)

    return {
        "source": "device",
        "points": _to_points(cleaned, flows, stages),
        "stages": stages,
    }


def curve_stats(curve: Dict[str, Any]) -> Dict[str, float]:
    """曲线的关键统计：总时长、最终重量、平均流速、峰值流速。"""
    pts = curve.get("points") or []
    if not pts:
        return {"duration": 0, "finalWeight": 0, "avgFlow": 0, "peakFlow": 0}

    duration = pts[-1]["t"]
    final_weight = pts[-1]["w"]
    peak = max(p["flow"] for p in pts)
    avg = sum(p["flow"] for p in pts) / len(pts)
    return {
        "duration": duration,
        "finalWeight": js_to_fixed(final_weight, 1),
        "avgFlow": js_to_fixed(avg, 3),
        "peakFlow": js_to_fixed(peak, 3),
    }
