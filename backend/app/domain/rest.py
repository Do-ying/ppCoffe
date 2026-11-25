"""养豆状态计算（后端口径）。

与前端 ``src/domain/rest.ts`` 保持一致 —— 首页摘要与豆子详情用同一套算法。

口径（按**自然日**计算）：
  - 0–6 天   → 养豆期 ``resting``
  - 7–21 天  → 赏味期 ``peak``
  - 22 天起  → 风味衰减期 ``fading``

起点：
  - 成品豆（kind=purchased_roasted）：豆子上的包装烘焙日期
  - 生豆（kind=green）：具体炉次的烘焙日期
  - 日期未知 → 阶段为 ``unknown``（页面显示「烘焙日期未知」）

养豆**状态**由日期计算；养豆**事件**由用户登记（``RestEvent``）。
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, Optional

__all__ = ["REST_STAGE_LABELS", "rest_stage", "rest_stage_info"]

#: 阶段标签（中文），前后端共用同一套文案
REST_STAGE_LABELS = {
    "resting": "养豆期",
    "peak": "赏味期",
    "fading": "风味衰减",
    "unknown": "烘焙日期未知",
}


def _as_date(value: Any) -> Optional[date]:
    """把各种日期形态统一成 ``date``。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    return None


def rest_stage(roast_date: Any, today: Optional[date] = None) -> str:
    """按自然日计算养豆阶段。

    :param roast_date: 烘焙日期（``date`` / ``datetime`` / ISO 字符串）
    :param today: 参考日期，默认今天
    :return: ``resting`` / ``peak`` / ``fading`` / ``unknown``
    """
    start = _as_date(roast_date)
    if start is None:
        return "unknown"
    ref = today or date.today()
    days = (ref - start).days
    if days < 0:
        # 烘焙日期在未来 —— 视为刚开始养豆
        return "resting"
    if days < 7:
        return "resting"
    if days <= 21:
        return "peak"
    return "fading"


def rest_stage_info(roast_date: Any, today: Optional[date] = None) -> Dict[str, Any]:
    """养豆阶段的完整信息（阶段、标签、天数）。"""
    start = _as_date(roast_date)
    stage = rest_stage(start, today)
    days = None if start is None else ((today or date.today()) - start).days
    return {
        "stage": stage,
        "label": REST_STAGE_LABELS.get(stage, stage),
        "days": days,
        "roastDate": start.isoformat() if start else None,
    }
