from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, utcnow
from app.models.enums import NotificationKind
from app.models.types import UTCDateTime, enum_type


class Notification(Base):
    """Уведомление пользователю. Поля tg_* — outbox для доставки в Telegram."""

    __tablename__ = "notifications"
    __table_args__ = (sa.Index("ix_notifications_user_read", "user_id", "is_read"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[NotificationKind] = mapped_column(enum_type(NotificationKind, "notification_kind"))
    title: Mapped[str] = mapped_column(sa.String(200))
    body: Mapped[str] = mapped_column(sa.Text, default="")
    link: Mapped[str | None] = mapped_column(sa.String(300))
    entity_type: Mapped[str | None] = mapped_column(sa.String(32))
    entity_id: Mapped[int | None] = mapped_column()
    is_read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    tg_status: Mapped[str] = mapped_column(sa.String(16), default="pending", index=True)
    tg_attempts: Mapped[int] = mapped_column(default=0)
    tg_sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    tg_error: Mapped[str | None] = mapped_column(sa.String(300))
    tg_payload: Mapped[dict[str, Any] | None] = mapped_column(sa.JSON)


class AuditEvent(Base):
    """Журнал значимых действий. Токены и пароли сюда не пишутся."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(sa.String(64), index=True)
    entity_type: Mapped[str | None] = mapped_column(sa.String(32))
    entity_id: Mapped[int | None] = mapped_column()
    org_id: Mapped[int | None] = mapped_column()
    details: Mapped[dict[str, Any]] = mapped_column(sa.JSON, default=dict)
    ip: Mapped[str | None] = mapped_column(sa.String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class IdempotencyKey(Base):
    """Повтор запроса с тем же Idempotency-Key возвращает сохранённый ответ, а не создаёт дубль."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (sa.UniqueConstraint("user_id", "scope", "key", name="user_scope_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    scope: Mapped[str] = mapped_column(sa.String(64))
    key: Mapped[str] = mapped_column(sa.String(64))
    status_code: Mapped[int | None] = mapped_column()
    response: Mapped[dict[str, Any] | None] = mapped_column(sa.JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class ProcessedUpdate(Base):
    """Защита от повторной обработки одного и того же Telegram update."""

    __tablename__ = "processed_updates"

    update_id: Mapped[int] = mapped_column(sa.BigInteger, primary_key=True, autoincrement=False)
    processed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
