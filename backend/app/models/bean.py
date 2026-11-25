"""豆子（Bean）模型。

字段见 docs/02-接口契约.md 第 3.1 节。
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy import Date, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import Base
from .mixins import TimestampMixin, to_iso

__all__ = ["Bean"]

PROCESS_VALUES = ("washed", "natural", "honey", "anaerobic", "other")
ROAST_LEVELS = ("light", "medium", "medium_dark", "dark")


class Bean(Base, TimestampMixin):
    """豆批次。"""

    __tablename__ = "beans"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="豆子 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True, comment="名称")
    roaster: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, comment="烘焙商")
    origin: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True, comment="产地信息(国家/产区/庄园/海拔/品种)"
    )
    process: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, comment="处理法")
    roast_level: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, comment="烘焙度")
    agtron: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="Agtron 读数")
    roast_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True, index=True, comment="烘焙日期")
    weight_grams: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="总重(g)")
    remaining_grams: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="剩余量(g)")
    tags: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True, comment="标签")
    image_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True, comment="包装图 URL")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="备注")
    source_file_key: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True, comment="原文件对象键(对象存储)"
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "roaster": self.roaster or "",
            "origin": self.origin or {},
            "process": self.process or "other",
            "roastLevel": self.roast_level or "medium",
            "agtron": self.agtron,
            "roastDate": self.roast_date.isoformat() if self.roast_date else None,
            "weightGrams": self.weight_grams or 0,
            "remainingGrams": self.remaining_grams or 0,
            "tags": self.tags or [],
            "imageUrl": self.image_url,
            "notes": self.notes or "",
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
