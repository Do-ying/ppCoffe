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

#: 豆子类型
#:
#: - ``purchased_roasted`` 成品豆：购入即可冲煮，烘焙度与烘焙日期在豆子这一层
#: - ``green`` 生豆：按购入批次登记库存，可分多炉烘焙，每炉单独记录
#: - ``None`` 待确认类型：旧数据迁移后的初始状态，确认前可查看历史
BEAN_KINDS = ("purchased_roasted", "green")


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
    #: 豆子类型：purchased_roasted 成品豆 / green 生豆 / None 待确认
    kind: Mapped[Optional[str]] = mapped_column(
        String(24), index=True, nullable=True, comment="豆子类型"
    )
    #: 实付豆款，单位「分」。为空表示未填写采购价；0 表示明确填了 0 元。
    purchase_cost_cents: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, comment="实付豆款(分)"
    )

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "roaster": self.roaster or "",
            "origin": self.origin or {},
            "process": self.process or "other",
            "roastLevel": None if self.kind == "green" else self.roast_level or "medium",
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
        # 类型与采购成本：kind 为 None 表示旧数据待确认
        data["kind"] = self.kind
        data["purchaseCostCents"] = self.purchase_cost_cents
        if self.source_file_key:
            data["sourceFileKey"] = self.source_file_key
            # MinIO 私有桶的访问地址有时效，读取时按对象键重新生成，
            # 否则列表里存的旧链接会过期（计划书第五节要求）
            data["imageUrl"] = self._fresh_image_url(self.source_file_key)
        return data

    @staticmethod
    def _fresh_image_url(object_key: str) -> str | None:
        """按对象键生成当前有效的访问地址。"""
        try:
            from ..services.storage import get_storage

            return get_storage().public_url(object_key)
        except Exception:
            return None
