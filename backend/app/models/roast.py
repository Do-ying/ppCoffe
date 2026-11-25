"""烘焙批次（RoastBatch）与其曲线。

字段见 docs/02-接口契约.md 第 3.6 节与第 5.5.2 节。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import Base
from .mixins import TimestampMixin, to_iso

__all__ = ["RoastBatch", "RoastCurve"]

ROAST_EVENT_TYPES = ("charge", "turningPoint", "dryEnd", "firstCrack", "drop")


class RoastBatch(Base, TimestampMixin):
    """烘焙批次。"""

    __tablename__ = "roasts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="烘焙批次 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    bean_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("beans.id", ondelete="CASCADE"), index=True, nullable=False
    )
    batch_no: Mapped[str] = mapped_column(String(64), index=True, nullable=False, comment="批次号")
    roaster: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, comment="烘焙设备")
    green_grams: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="投豆量(g)")
    out_grams: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="出豆量(g)")
    weight_loss_percent: Mapped[float] = mapped_column(
        Float, default=0.0, nullable=False, comment="失重率(%)"
    )
    total_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="总时长(s)")
    events: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, comment="事件序列 charge/turningPoint/dryEnd/firstCrack/drop"
    )
    dtr_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False, comment="发展比(%)")
    phase_ratio: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True, comment="阶段占比(%)"
    )
    cupping_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="杯测分")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="备注")
    roast_date: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True, nullable=False, comment="烘焙时间(UTC)"
    )
    target_profile_id: Mapped[Optional[str]] = mapped_column(
        String(40), nullable=True, comment="目标 profile"
    )
    source_file_key: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True, comment=".alog 原文件对象键"
    )

    curve: Mapped[Optional["RoastCurve"]] = relationship(
        back_populates="roast", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )

    def to_dict(self, *, with_curve: bool = True) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "beanId": self.bean_id,
            "batchNo": self.batch_no,
            "roaster": self.roaster or "",
            "greenGrams": self.green_grams or 0,
            "outGrams": self.out_grams or 0,
            "weightLossPercent": self.weight_loss_percent or 0,
            "totalSeconds": self.total_seconds or 0,
            "events": self.events or [],
            "dtrPercent": self.dtr_percent or 0,
            "phaseRatio": self.phase_ratio or {"drying": 0, "maillard": 0, "development": 0},
            "roastDate": to_iso(self.roast_date),
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
        if self.cupping_score is not None:
            data["cuppingScore"] = self.cupping_score
        if self.notes:
            data["notes"] = self.notes
        if with_curve and self.curve is not None:
            data["curve"] = self.curve.to_dict()
        return data


class RoastCurve(Base, TimestampMixin):
    """烘焙曲线（三通道 BT/ET/RoR）。"""

    __tablename__ = "roast_curves"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="曲线 ID")
    roast_id: Mapped[str] = mapped_column(
        String(40),
        ForeignKey("roasts.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    source: Mapped[str] = mapped_column(
        String(32), default="live", nullable=False, comment="来源 keypoint/live/import"
    )
    x_axis: Mapped[str] = mapped_column(String(16), default="time", nullable=False, comment="横轴")
    unit: Mapped[str] = mapped_column(String(16), default="second", nullable=False, comment="单位")
    points: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, comment="曲线点 [{t,bt,et,ror}]"
    )
    events: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True, comment="事件序列")
    meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="附加信息")

    roast: Mapped["RoastBatch"] = relationship(back_populates="curve")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "ownerType": "roast",
            "ownerId": self.roast_id,
            "source": self.source,
            "xAxis": self.x_axis,
            "unit": self.unit,
            "points": self.points or [],
            "events": self.events or [],
            "meta": self.meta or {},
        }
