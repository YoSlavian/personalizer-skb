from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow
from app.models.enums import SessionKind, UserRole
from app.models.types import UTCDateTime, enum_type


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(sa.String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(sa.String(255))
    full_name: Mapped[str] = mapped_column(sa.String(200))
    role: Mapped[UserRole] = mapped_column(enum_type(UserRole, "user_role"))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    settings: Mapped["UserSettings"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="selectin")
    telegram_links: Mapped[list["TelegramLink"]] = relationship(back_populates="user", cascade="all, delete-orphan", lazy="selectin")

    @property
    def is_staff(self) -> bool:
        return self.role != UserRole.client


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    notify_telegram: Mapped[bool] = mapped_column(default=True)
    notify_applications: Mapped[bool] = mapped_column(default=True)
    notify_tasks: Mapped[bool] = mapped_column(default=True)
    notify_offers: Mapped[bool] = mapped_column(default=True)
    adaptive_hints: Mapped[bool] = mapped_column(default=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="settings")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(sa.String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(sa.String(64))
    kind: Mapped[SessionKind] = mapped_column(enum_type(SessionKind, "session_kind"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    ip: Mapped[str | None] = mapped_column(sa.String(64))
    user_agent: Mapped[str | None] = mapped_column(sa.String(300))

    user: Mapped[User] = relationship(lazy="joined")


class TelegramLink(Base):
    """Привязка Telegram-аккаунта к пользователю. Один пользователь может иметь несколько устройств."""

    __tablename__ = "telegram_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    telegram_user_id: Mapped[int] = mapped_column(sa.BigInteger, unique=True)
    chat_id: Mapped[int] = mapped_column(sa.BigInteger)
    username: Mapped[str | None] = mapped_column(sa.String(64))
    via: Mapped[str] = mapped_column(sa.String(16), default="code")
    linked_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="telegram_links", lazy="joined")


class LinkCode(Base):
    """Одноразовый код для привязки Telegram из веб-кабинета (хранится только хеш)."""

    __tablename__ = "link_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(sa.String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
