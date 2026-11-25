"""养豆事件（RestEvent）模型。

用户在冲煮前后手动登记的养豆动作：开袋、密封/分装、养豆备注等。

关联层级：
  - 成品豆（kind=purchased_roasted）：事件挂在**购入批次**（roast_batch_id 为空）
  - 生豆（kind=green）：事件挂在**具体炉次**（roast_batch_id 必填）

养豆状态由日期计算（本模型只存事件，不存状态），
见 ``app/domain/rest.py`` 的 ``rest_stage``。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import Base
from .mixins import TimestampMixin, to_iso

__all__ = ["RestEvent", "REST_EVENT_TYPES"]

#: 养豆事件类型
REST_EVENT_TYPES = ("opened", "sealed", "divided", "note")


class RestEvent(Base, TimestampMixin):
    """养豆事件。"""

    __tablename__ = "rest_events"
    __table_args__ = (Index("ix_rest_events_bean_at", "bean_id", "occurred_at"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="事件 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    bean_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("beans.id", ondelete="CASCADE"), index=True, nullable=False,
        comment="所属豆子(购入批次)"
    )
    #: 生豆事件挂在具体炉次；成品豆为 None（挂在购入批次上）
    roast_batch_id: Mapped[Optional[str]] = mapped_column(
        String(40), ForeignKey("roasts.id", ondelete="CASCADE"), index=True, nullable=True,
        comment="关联炉次(生豆必填)"
    )
    #: 事件类型：opened 开袋 / sealed 密封 / divided 分装 / note 备注
    type: Mapped[str] = mapped_column(
        String(24), nullable=False, comment="事件类型"
    )
    #: 事件发生时刻（UTC）
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True, comment="发生时刻(UTC)"
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="备注")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "beanId": self.bean_id,
            "roastBatchId": self.roast_batch_id,
            "type": self.type,
            "occurredAt": to_iso(self.occurred_at),
            "note": self.note or "",
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
