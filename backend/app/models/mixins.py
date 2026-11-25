"""模型公共部分。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

__all__ = ["utcnow", "to_iso", "TimestampMixin"]


def utcnow() -> datetime:
    """当前 UTC 时间（naive，MySQL DATETIME 不带时区，统一按 UTC 存）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso(value: Optional[datetime]) -> Optional[str]:
    """序列化为 ISO 8601（UTC，带 Z 后缀）。"""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class TimestampMixin:
    """创建/更新时间戳。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, comment="创建时间(UTC)"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False, comment="更新时间(UTC)"
    )

    def touch(self) -> None:
        self.updated_at = utcnow()
