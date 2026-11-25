"""器具（Equipment）、配方（Recipe）、上传对象（Upload）模型。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import Base
from .mixins import TimestampMixin, to_iso

__all__ = ["Equipment", "Recipe", "Upload"]

EQUIPMENT_TYPES = (
    "grinder",
    "dripper",
    "brewer",
    "espresso",
    "scale",
    "roaster",
    "other",
)


class Equipment(Base, TimestampMixin):
    """器具 / 设备。"""

    __tablename__ = "equipment"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="器具 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    type: Mapped[str] = mapped_column(String(32), index=True, nullable=False, comment="类型")
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="名称")
    brand: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, comment="品牌")
    model: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, comment="型号")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="刻度基准/备注")
    is_preset: Mapped[bool] = mapped_column(default=False, nullable=False, comment="是否内置预设")

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
        if self.brand:
            data["brand"] = self.brand
        if self.model:
            data["model"] = self.model
        if self.notes:
            data["notes"] = self.notes
        return data


class Recipe(Base, TimestampMixin):
    """配方模板。"""

    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="配方 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True, comment="配方名")
    method: Mapped[str] = mapped_column(String(64), index=True, nullable=False, comment="冲煮方式 id")
    params: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, comment="参数")
    steps: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True, comment="注水计划")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="备注")
    favorite: Mapped[bool] = mapped_column(default=False, nullable=False, comment="是否收藏")

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "method": self.method,
            "params": self.params or {},
            "steps": self.steps or [],
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
        if self.notes:
            data["notes"] = self.notes
        if self.favorite:
            data["favorite"] = True
        return data


class Upload(Base, TimestampMixin):
    """对象存储中的文件记录。"""

    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="上传记录 ID")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(40), index=True, nullable=True, comment="归属用户"
    )
    object_key: Mapped[str] = mapped_column(
        String(512), index=True, nullable=False, comment="对象键"
    )
    bucket: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, comment="桶")
    url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True, comment="访问 URL")
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, comment="MIME")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="字节数")
    caption: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, comment="说明")
    owner_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, comment="归属类型")
    owner_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True, comment="归属记录 ID")

    def to_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "id": self.id,
            "objectKey": self.object_key,
            "url": self.url or "",
            "sizeBytes": self.size_bytes or 0,
        }
        if self.caption:
            data["caption"] = self.caption
        if self.content_type:
            data["contentType"] = self.content_type
        return data
