from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow
from app.models.enums import AbVariant, Channel, CommStatus
from app.models.types import UTCDateTime, enum_type


class RuleSet(Base):
    """Версия бизнес-правил персонализации. Активна ровно одна версия."""

    __tablename__ = "rule_sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(unique=True)
    config: Mapped[dict[str, Any]] = mapped_column(sa.JSON)
    comment: Mapped[str] = mapped_column(sa.String(300), default="")
    is_active: Mapped[bool] = mapped_column(default=False, index=True)
    created_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    author = relationship("User", lazy="joined")


class Decision(Base):
    """Сохранённое решение оптимизатора: вход (профиль) и выход (предложение, канал, частота, NBA)."""

    __tablename__ = "decisions"
    __table_args__ = (sa.Index("ix_decisions_org_created", "org_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"))
    rule_version: Mapped[int] = mapped_column()
    variant: Mapped[AbVariant] = mapped_column(enum_type(AbVariant, "ab_variant"))
    product_code: Mapped[str | None] = mapped_column(sa.String(32))
    trigger: Mapped[str] = mapped_column(sa.String(16))
    profile: Mapped[dict[str, Any]] = mapped_column(sa.JSON)
    result: Mapped[dict[str, Any]] = mapped_column(sa.JSON)
    created_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class CampaignRun(Base):
    __tablename__ = "campaign_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    dry_run: Mapped[bool] = mapped_column(default=False)
    rule_version: Mapped[int] = mapped_column()
    scope: Mapped[dict[str, Any]] = mapped_column(sa.JSON)
    stats: Mapped[dict[str, Any]] = mapped_column(sa.JSON, default=dict)

    author = relationship("User", lazy="joined")


class Communication(Base):
    """Одна коммуникация по одному каналу: плейсмент, push, email или звонок КМ."""

    __tablename__ = "communications"
    __table_args__ = (
        sa.Index("ix_communications_org_created", "org_id", "created_at"),
        sa.CheckConstraint("clicks >= 0", name="clicks_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_run_id: Mapped[int | None] = mapped_column(sa.ForeignKey("campaign_runs.id", ondelete="SET NULL"), index=True)
    decision_id: Mapped[int | None] = mapped_column(sa.ForeignKey("decisions.id", ondelete="SET NULL"))
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"))
    group_id: Mapped[int | None] = mapped_column(sa.ForeignKey("company_groups.id", ondelete="SET NULL"), index=True)
    variant: Mapped[AbVariant] = mapped_column(enum_type(AbVariant, "ab_variant"), index=True)
    product_code: Mapped[str] = mapped_column(sa.String(32), index=True)
    channel: Mapped[Channel] = mapped_column(enum_type(Channel, "channel"))
    recipient: Mapped[str] = mapped_column(sa.String(200))
    headline: Mapped[str] = mapped_column(sa.String(300))
    body: Mapped[str] = mapped_column(sa.String(1000))
    cta: Mapped[str] = mapped_column(sa.String(100))
    visual: Mapped[str] = mapped_column(sa.String(32))
    status: Mapped[CommStatus] = mapped_column(enum_type(CommStatus, "comm_status"), index=True)
    blocked_reason: Mapped[str | None] = mapped_column(sa.String(300))
    clicks: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    shown_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    clicked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    hidden_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    converted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    organization = relationship("Organization", lazy="joined")


class JourneySession(Base):
    """Сессия цифрового пути «главная → витрина → калькулятор → заявка» с сигналами и адаптациями."""

    __tablename__ = "journey_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    product_code: Mapped[str] = mapped_column(sa.String(32))
    communication_id: Mapped[int | None] = mapped_column(sa.ForeignKey("communications.id", ondelete="SET NULL"))
    application_id: Mapped[int | None] = mapped_column(sa.ForeignKey("applications.id", ondelete="SET NULL"))
    source: Mapped[str] = mapped_column(sa.String(16), default="web")
    adapt: Mapped[bool] = mapped_column(default=True)
    variant: Mapped[AbVariant] = mapped_column(enum_type(AbVariant, "ab_variant"))
    outcome: Mapped[str] = mapped_column(sa.String(16), default="open")
    steps: Mapped[int] = mapped_column(default=0)
    returns: Mapped[int] = mapped_column(default=0)
    recalcs: Mapped[int] = mapped_column(default=0)
    hints_shown: Mapped[int] = mapped_column(default=0)
    hints_closed: Mapped[int] = mapped_column(default=0)
    state: Mapped[dict[str, Any]] = mapped_column(sa.JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_event_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    time_to_apply_sec: Mapped[int | None] = mapped_column()


class JourneyEvent(Base):
    __tablename__ = "journey_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(sa.ForeignKey("journey_sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(sa.String(32))
    screen: Mapped[str | None] = mapped_column(sa.String(32))
    meta: Mapped[dict[str, Any]] = mapped_column(sa.JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
