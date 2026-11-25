"""冲煮记录（BrewRecord）与其曲线。

字段见 docs/02-接口契约.md 第 3.3 / 3.4 / 3.5 节。

曲线点单独成表（``brew_curves``），不塞进主表的 text 字段：
点数可达上千，单独成表便于按 ``(brew_id, t)`` 建复合索引。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import Base
from .mixins import TimestampMixin, to_iso

__all__ = ["BrewRecord", "BrewCurve"]


class BrewRecord(Base, TimestampMixin):
    """冲煮记录。"""

    __tablename__ = "brews"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="冲煮记录 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    bean_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("beans.id", ondelete="CASCADE"), index=True, nullable=False
    )
    roast_batch_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="关联的烘焙批次"
    )
    method: Mapped[str] = mapped_column(String(64), index=True, nullable=False, comment="冲煮方式 id")
    equipment_ids: Mapped[Optional[List[str]]] = mapped_column(
        JSON, nullable=True, comment="使用的器具 id 列表"
    )
    params: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="冲煮参数")
    steps: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, comment="分段注水计划"
    )
    flavor: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="风味画像")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="风味短备注")
    review: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="评鉴内容(长文本)")
    images: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, comment="附图列表"
    )
    brew_date: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True, nullable=False, comment="冲煮时间(UTC)"
    )
    source_file_key: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True, comment="原文件对象键(对象存储)"
    )

    curve: Mapped[Optional["BrewCurve"]] = relationship(
        back_populates="brew", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )

    def to_dict(self, *, with_curve: bool = True) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "beanId": self.bean_id,
            "method": self.method,
            "params": self.params or {},
            "steps": self.steps or [],
            "flavor": self.flavor or {},
            "notes": self.notes or "",
            "brewDate": to_iso(self.brew_date),
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
        if self.roast_batch_id:
            data["roastBatchId"] = self.roast_batch_id
        if self.equipment_ids:
            data["equipmentIds"] = self.equipment_ids
        if self.review:
            data["review"] = self.review
        if self.images:
            data["images"] = self.images
        if with_curve:
            data["curve"] = self.curve.to_dict() if self.curve else {"source": "plan", "points": [], "stages": []}
        return data


class BrewCurve(Base, TimestampMixin):
    """冲煮曲线。"""

    __tablename__ = "brew_curves"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="曲线 ID")
    brew_id: Mapped[str] = mapped_column(
        String(40),
        ForeignKey("brews.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    source: Mapped[str] = mapped_column(
        String(32), default="plan", nullable=False, comment="来源 plan/keypoint/device/import/live"
    )
    x_axis: Mapped[str] = mapped_column(String(16), default="time", nullable=False, comment="横轴")
    unit: Mapped[str] = mapped_column(String(16), default="second", nullable=False, comment="单位")
    points: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, comment="曲线点 [{t,w,flow,stage}]"
    )
    stages: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(
        JSON, nullable=True, comment="阶段区间 [{from,to,label,stage}]"
    )
    meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="附加信息")

    brew: Mapped["BrewRecord"] = relationship(back_populates="curve")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "ownerType": "brew",
            "ownerId": self.brew_id,
            "source": self.source,
            "xAxis": self.x_axis,
            "unit": self.unit,
            "points": self.points or [],
            "stages": self.stages or [],
            "meta": self.meta or {},
        }
