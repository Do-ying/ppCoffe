"""风味偏差诊断引擎

对应前端 ``src/domain/diagnosis/index.ts``。

核心思想：把「用户喝到的风味」与「该冲煮方式的目标风味基线」做对比，
再用咖啡萃取的因果链反推「下一杯该改什么」。

判定依据（docs/00-产品与页面规划.md 第 3.3 节）：

* 尖酸、缺乏甜感、余韵短   → 萃取不足
* 苦、干涩、发干、空洞     → 萃取过度
* 酸质够但甜感缺失         → 萃取不均 / 研磨细分粉问题
* 意式出现尖酸锐利         → 浓度放大酸质
* 风味淡薄如水             → 粉水比过低或萃取不均
* 焦糊烟熏                 → 局部过热或烘焙过深
"""

from __future__ import annotations

from typing import Any, Dict, List

from .flavor import FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS, axes_delta, match_score

__all__ = ["VERDICT_LABELS", "compute_deviations", "diagnose", "describe_deviation"]

VERDICT_LABELS: Dict[str, str] = {
    "under_extracted": "萃取不足",
    "over_extracted": "萃取过度",
    "uneven": "萃取不均",
    "flat": "风味平淡",
    "ok": "风味吻合",
}

_AXIS_REASON: Dict[str, str] = {
    "acidity": "酸质",
    "sweetness": "甜感",
    "body": "醇厚",
    "flavor": "风味强度",
    "aftertaste": "余韵",
    "balance": "平衡",
}


def compute_deviations(
    actual: Dict[str, float], baseline: Dict[str, float]
) -> List[Dict[str, Any]]:
    """计算偏差列表（仅保留 |delta| >= 2 的轴，按偏差绝对值倒序）。"""
    delta = axes_delta(actual, baseline)
    deviations = [
        {
            "axis": key,
            "label": FLAVOR_AXIS_LABELS[key],
            "actual": actual.get(key, 0),
            "expected": baseline.get(key, 0),
            "delta": delta[key],
            "direction": "over" if delta[key] >= 0 else "under",
        }
        for key in FLAVOR_AXIS_KEYS
    ]
    deviations = [d for d in deviations if abs(d["delta"]) >= 2]
    deviations.sort(key=lambda d: abs(d["delta"]), reverse=True)
    return deviations


def diagnose(method: Dict[str, Any], flavor: Dict[str, Any]) -> Dict[str, Any]:
    """主诊断入口。

    :param method: 冲煮方式元数据（提供目标基线与方式特性）
    :param flavor: 用户记录的风味
    """
    baseline = method["flavorBaseline"]
    actual = flavor.get("axes", {})
    score = match_score(actual, baseline)
    deviations = compute_deviations(actual, baseline)

    def d(key: str) -> float:
        return actual.get(key, 0) - baseline.get(key, 0)

    # 欠萃倾向：酸质高于基线 + 甜感低于基线
    under_score = d("acidity") * 1.2 + (d("sweetness") * -1) * 1.0 + d("balance") * -0.5
    # 过萃倾向：醇厚偏高 + 平衡/余韵偏低
    over_score = d("body") * 0.8 + (d("balance") * -1) * 1.0 + (d("aftertaste") * -1) * 0.8
    # 平淡：所有轴都低于基线
    all_low = all(d(k) <= -2 for k in FLAVOR_AXIS_KEYS)
    # 不均：酸甜都高但平衡低（尖酸与高甜同时出现通常说明萃取不均）
    uneven = d("acidity") >= 2 and d("sweetness") >= 2 and d("balance") <= -2

    verdict = "ok"
    if all_low:
        verdict = "flat"
    elif uneven:
        verdict = "uneven"
    elif under_score >= 2:
        verdict = "under_extracted"
    elif over_score >= 2:
        verdict = "over_extracted"

    prescriptions = _build_prescriptions(verdict, method, flavor)

    return {
        "matchScore": score,
        "verdict": verdict,
        "verdictLabel": VERDICT_LABELS[verdict],
        "deviations": deviations,
        "prescriptions": prescriptions,
        "baseline": baseline,
    }


def _build_prescriptions(
    verdict: str, method: Dict[str, Any], flavor: Dict[str, Any]
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    is_espresso = method.get("category") == "pressure" and method.get("id") == "espresso"
    is_pour_over = method.get("category") == "percolation"
    defects = flavor.get("defects") or []

    if verdict == "under_extracted":
        items.append(
            {
                "action": "grind_finer",
                "label": "研磨调细",
                "delta": "1-2 格",
                "reason": "酸质高于该方式的基线且甜感不足，是典型的欠萃特征",
                "category": "grind",
            }
        )
        items.append(
            {
                "action": "dose_up",
                "label": "增加粉量",
                "delta": "粉水比上调 0.5",
                "reason": "提高浓度以补上缺失的甜感与醇厚",
                "category": "ratio",
            }
        )
        items.append(
            {
                "action": "raise_temp",
                "label": "提高水温",
                "delta": "+2℃",
                "reason": (
                    "浅焙豆在当前水温下溶出不足，提高水温能加快萃取"
                    if is_pour_over
                    else "提高水温可加快萃取速率"
                ),
                "category": "temp",
            }
        )
        items.append(
            {
                "action": "extend_time",
                "label": "延长萃取时间",
                "delta": "+10s",
                "reason": "延长接触时间，补足欠萃的甜感与余韵",
                "category": "time",
            }
        )
        if is_pour_over:
            items.append(
                {
                    "action": "stronger_pour",
                    "label": "加强搅拌与注水",
                    "reason": "加强扰动可提升萃取均匀度，减少局部欠萃",
                    "category": "technique",
                }
            )
        if is_espresso:
            items.append(
                {
                    "action": "change_bean",
                    "label": "考虑换豆或加深烘焙",
                    "reason": "高浓度会放大浅焙豆的酸锐度，换低酸豆或更深烘焙更适配意式",
                    "category": "bean",
                }
            )

    elif verdict == "over_extracted":
        items.append(
            {
                "action": "grind_coarser",
                "label": "研磨调粗",
                "delta": "1-2 格",
                "reason": "苦感与干涩感偏重，通常是研磨过细导致的过度萃取",
                "category": "grind",
            }
        )
        items.append(
            {
                "action": "shorten_time",
                "label": "缩短萃取时间",
                "delta": "-10s",
                "reason": "减少与咖啡粉的接触时间，拉回苦感",
                "category": "time",
            }
        )
        items.append(
            {
                "action": "lower_temp",
                "label": "降低水温",
                "delta": "-2℃",
                "reason": "降低溶出速率，避免后段苦咸物质被带出",
                "category": "temp",
            }
        )
        items.append(
            {
                "action": "gentler_pour",
                "label": "减缓注水",
                "reason": "减缓扰动可降低萃取强度",
                "category": "technique",
            }
        )

    elif verdict == "uneven":
        items.append(
            {
                "action": "better_agitation",
                "label": "改善搅拌均匀度",
                "reason": "酸甜同时偏高而平衡度偏低，典型的萃取不均——粉层有局部过萃与局部欠萃并存",
                "category": "technique",
            }
        )
        items.append(
            {
                "action": "check_roast",
                "label": "检查熟豆新鲜度与细粉",
                "reason": "细粉过多或豆子不新鲜都会造成萃取不均",
                "category": "roast",
            }
        )
        items.append(
            {
                "action": "dose_up",
                "label": "适当增加粉量",
                "delta": "+1g",
                "reason": "更厚的粉床能提高萃取稳定性",
                "category": "ratio",
            }
        )

    elif verdict == "flat":
        items.append(
            {
                "action": "dose_up",
                "label": "提高粉水比",
                "delta": "粉水比收紧 1",
                "reason": "各项风味都偏弱，说明浓度不足，先把粉水比拉近",
                "category": "ratio",
            }
        )
        items.append(
            {
                "action": "raise_temp",
                "label": "提高水温",
                "delta": "+2℃",
                "reason": "适度提高水温提升整体强度与甜感",
                "category": "temp",
            }
        )

    else:  # ok
        items.append(
            {
                "action": "keep",
                "label": "保持当前配方",
                "reason": (
                    f"风味与{method.get('name', '该方式')}的目标基线吻合度 "
                    f"{match_score(flavor.get('axes', {}), method['flavorBaseline'])}%"
                ),
                "category": "keep",
            }
        )
        items.append(
            {
                "action": "grind_finer",
                "label": "下一杯只改一个变量",
                "delta": "建议从研磨度开始",
                "reason": "一次只改一个变量，才能把风味变化归因清楚",
                "category": "keep",
            }
        )

    # 缺陷标记的补充建议
    defect_ids = {x.get("id") for x in defects}
    if {"burnt", "smoky"} & defect_ids:
        items.append(
            {
                "action": "check_roast",
                "label": "检查烘焙曲线",
                "reason": "出现焦糊/烟熏，通常来自烘焙过深或 RoR crash，也可能是注水流速过慢造成的局部过热",
                "category": "roast",
            }
        )
    if {"papery", "woody"} & defect_ids:
        items.append(
            {
                "action": "check_roast",
                "label": "检查豆子新鲜度",
                "reason": "纸板味/木质味通常指向氧化过度，注意烘焙日期与养豆期",
                "category": "roast",
            }
        )

    # 重新编号
    return [{**p, "priority": i + 1} for i, p in enumerate(items)]


def describe_deviation(deviation: Dict[str, Any]) -> str:
    """偏差轴的中文说明，供 UI 直接展示。"""
    axis = _AXIS_REASON.get(deviation["axis"], deviation["axis"])
    direction = "偏高" if deviation["direction"] == "over" else "偏低"
    return (
        f"{axis}{direction} {abs(deviation['delta'])} 分"
        f"（实测 {deviation['actual']} / 目标 {deviation['expected']}）"
    )
