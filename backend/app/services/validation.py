"""生豆数量校验（事务内加锁，防止并发超用）。

计划书「三、生豆用量与每克成本」的校验规则：

- 每炉满足 ``0 < 出豆克数 ≤ 投豆克数``
- 每个购入批次累计投豆量上限为购入克数
- 新建、改量或导入时，后端在**同一事务内锁定购入批次**并校验，防止并发超用
- 重复提交同一炉时沿用同一个提交标识，避免重复计入
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy import select, update

from ..errors import Conflict, ValidationFailed
from ..extensions import db
from ..models.bean import Bean
from ..models.roast import RoastBatch

__all__ = [
    "assert_roast_quantity",
    "lock_bean_for_stock",
    "used_green_grams",
]


def lock_bean_for_stock(bean_id: str) -> Bean:
    """锁定购入批次（行锁），返回豆子。

    在同一事务内串行化对该批次的库存变更 —— 并发提交时后到的请求
    会等待前一个事务提交，读到的是**已更新后**的累计投豆量。
    """
    if db.engine.dialect.name == "sqlite":
        # SQLite 忽略 FOR UPDATE。写入原值以提前取得事务写锁。
        db.session.execute(
            update(Bean).where(Bean.id == bean_id).values(updated_at=Bean.updated_at)
        )
    stmt = (
        select(Bean).where(Bean.id == bean_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    bean = db.session.execute(stmt).scalar_one_or_none()
    if bean is None:
        raise ValidationFailed(
            "豆子不存在", details={"beanId": bean_id}, field="beanId"
        )
    return bean


def used_green_grams(
    bean_id: str, exclude_roast_id: Optional[str] = None
) -> int:
    """该购入批次下**已完成炉次**的投豆克数之和。"""
    stmt = select(RoastBatch).where(RoastBatch.bean_id == bean_id)
    if exclude_roast_id:
        stmt = stmt.where(RoastBatch.id != exclude_roast_id)
    roasts = db.session.execute(
        stmt.with_for_update().execution_options(populate_existing=True)
    ).scalars().all()
    return sum(roast.green_grams for roast in roasts if roast.is_completed())


def assert_roast_quantity(
    bean: Bean,
    green_grams: int,
    out_grams: int,
    exclude_roast_id: Optional[str] = None,
) -> None:
    """校验一炉的克数与该批次的累计用量。

    :param bean: 购入批次（已加锁）
    :param green_grams: 本炉投豆克数
    :param out_grams: 本炉出豆克数
    :param exclude_roast_id: 改量时排除自身
    """
    if green_grams <= 0:
        raise ValidationFailed(
            "投豆克数必须大于零",
            details={"greenGrams": green_grams},
            field="greenGrams",
        )
    if out_grams <= 0:
        raise ValidationFailed(
            "出豆克数必须大于零",
            details={"outGrams": out_grams},
            field="outGrams",
        )
    if out_grams > green_grams:
        raise ValidationFailed(
            "出豆克数不能大于投豆克数",
            details={"greenGrams": green_grams, "outGrams": out_grams},
            field="outGrams",
        )

    purchased = bean.weight_grams or 0
    used = used_green_grams(bean.id, exclude_roast_id)
    if used + green_grams > purchased:
        raise Conflict(
            "生豆用量超出购入克数",
            details={
                "purchasedGrams": purchased,
                "usedGreenGrams": used,
                "requestedGrams": green_grams,
                "remainingGrams": max(purchased - used, 0),
            },
        )
