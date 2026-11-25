"""用户模型。

微信小程序场景：``wx.login`` code → openid → 用户表 → JWT。
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import Base
from .mixins import TimestampMixin, to_iso

__all__ = ["User"]


class User(Base, TimestampMixin):
    """用户。"""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, comment="用户 ID")
    openid: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False, comment="微信 openid / 登录标识"
    )
    unionid: Mapped[Optional[str]] = mapped_column(
        String(64), unique=True, nullable=True, comment="微信 unionid"
    )
    nickname: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, comment="昵称")
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True, comment="头像")
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False, comment="是否启用")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "nickname": self.nickname or "",
            "avatarUrl": self.avatar_url or "",
            "createdAt": to_iso(self.created_at),
            "updatedAt": to_iso(self.updated_at),
        }
