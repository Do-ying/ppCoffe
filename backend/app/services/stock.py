"""豆子库存汇总与每克成本。

计划书「三、生豆用量与每克成本」的口径实现：

- **生豆已用克数** = 该购入批次下有效、已完成炉次的投豆克数之和
- **剩余生豆克数** = 购入克数 − 已用克数
- 读取时按炉次汇总，由豆子接口返回 ``usedGreenGrams`` 与计算后的 ``remainingGrams``
- 历史投豆克数待核对时（缺失或为 0），已用和剩余返回空值，页面显示「库存待核对」
- **每克成本** = 实付豆款 ÷ 购入克数，四舍五入到小数点后四位
  - 豆款留空 → ``null``，页面显示「未填写采购价」
  - 明确填 0 元 → ``0.0000``
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from ..models.bean import Bean
from ..models.roast import RoastBatch

__all__ = [
    "COST_PRECISION",
    "bean_cost_per_gram",
    "bean_rest_anchor_date",
    "green_stock_summary",
    "summarize_bean_stock",
]

#: 每克成本保留小数位数
COST_PRECISION = 4


def bean_rest_anchor_date(bean: Bean, roasts: List[RoastBatch]) -> Optional[date]:
    """养豆起算日期。

    计划书「二、数据关系与保存规则」：养豆天数以**成品豆包装上的烘焙日期**，
    或**对应炉次的烘焙日期**为起点。首页摘要与豆子详情共用本函数，
    避免两处各算一套。

    - 成品豆（``kind`` 为 ``purchased_roasted`` 或 ``None``）：用豆子上的烘焙日期
    - 生豆（``kind == "green"``）：用**最近一炉已完成炉次**的烘焙日期
    - 取不到日期 → ``None``（页面显示「烘焙日期未知」）
    """
    if bean.kind != "green":
        return bean.roast_date

    completed = [r for r in roasts if r.bean_id == bean.id and r.is_completed()]
    if not completed:
        return None
    latest = max(completed, key=lambda r: (r.roast_date or r.created_at or datetime.min))
    return latest.roast_date


def bean_cost_per_gram(bean: Bean) -> Optional[float]:
    """每克成本（元/克）。

    购入克数为 0 或豆款未填写时返回 ``None``（页面显示「未填写采购价」）。
    """
    if bean.purchase_cost_cents is None:
        return None
    grams = bean.weight_grams or 0
    if grams <= 0:
        return None
    cost = Decimal(bean.purchase_cost_cents) / (100 * grams)
    return float(cost.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def green_stock_summary(
    bean: Bean, roasts: List[RoastBatch]
) -> Dict[str, Any]:
    """生豆库存汇总。

    :param bean: 购入批次
    :param roasts: 该批次下的炉次
    :return: ``{"usedGreenGrams": int|None, "remainingGrams": int|None, "stockPending": bool}``
    """
    relevant = [r for r in roasts if r.bean_id == bean.id]
    if not relevant:
        # 还没有炉次：已用 0，剩余 = 购入克数
        grams = bean.weight_grams or 0
        return {
            "usedGreenGrams": 0,
            "remainingGrams": grams,
            "stockPending": False,
        }

    if any(not (0 < r.out_grams <= r.green_grams) for r in relevant):
        return {
            "usedGreenGrams": None,
            "remainingGrams": None,
            "stockPending": True,
        }

    used = sum((r.green_grams or 0) for r in relevant if r.is_completed())
    grams = bean.weight_grams or 0
    if used > grams:
        return {"usedGreenGrams": None, "remainingGrams": None, "stockPending": True}
    return {
        "usedGreenGrams": used,
        "remainingGrams": max(grams - used, 0),
        "stockPending": False,
    }


def summarize_bean_stock(bean: Bean, roasts: List[RoastBatch]) -> Dict[str, Any]:
    """豆子的库存与成本汇总（两种豆子统一口径）。

    成品豆沿用现有「剩余量录入」方式：``remainingGrams`` 取豆子上的录入值。
    生豆按炉次汇总计算。
    """
    summary: Dict[str, Any] = {
        "costPerGram": bean_cost_per_gram(bean),
        "usedGreenGrams": None,
        "remainingGrams": bean.remaining_grams or 0,
        "stockPending": False,
    }
    if bean.kind == "green":
        summary.update(green_stock_summary(bean, roasts))
    return summary
