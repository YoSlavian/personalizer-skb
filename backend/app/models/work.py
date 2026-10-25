from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow
from app.models.enums import AppSource, AppStatus, Priority, TaskKind, TaskStatus
from app.models.types import UTCDateTime, enum_type


class Application(Base):
    """Заявка клиента на продукт — целевое действие пути."""

    __tablename__ = "applications"
    __table_args__ = (
        sa.CheckConstraint("amount_rub > 0", name="amount_positive"),
        sa.CheckConstraint("term_months >= 1 AND term_months <= 360", name="term_range"),
        sa.Index("ix_applications_org_status", "org_id", "status"),
        sa.Index("ix_applications_assignee_status", "assignee_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(sa.String(24), unique=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"))
    created_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    assignee_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    product_code: Mapped[str] = mapped_column(sa.String(32))
    amount_rub: Mapped[int] = mapped_column(sa.BigInteger)
    term_months: Mapped[int] = mapped_column()
    comment: Mapped[str | None] = mapped_column(sa.Text)
    status: Mapped[AppStatus] = mapped_column(enum_type(AppStatus, "app_status"))
    source: Mapped[AppSource] = mapped_column(enum_type(AppSource, "app_source"))
    communication_id: Mapped[int | None] = mapped_column(sa.ForeignKey("communications.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    organization = relationship("Organization", lazy="joined")
    author = relationship("User", foreign_keys=[created_by], lazy="joined")
    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")


class ApplicationComment(Base):
    __tablename__ = "application_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(sa.ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(sa.Text)
    internal: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    author = relationship("User", lazy="joined")


class Task(Base):
    """Задача клиентского менеджера. dedupe_key защищает от повторного создания по одному событию."""

    __tablename__ = "tasks"
    __table_args__ = (sa.Index("ix_tasks_assignee_status", "assignee_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    assignee_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[TaskKind] = mapped_column(enum_type(TaskKind, "task_kind"))
    title: Mapped[str] = mapped_column(sa.String(200))
    description: Mapped[str] = mapped_column(sa.Text, default="")
    priority: Mapped[Priority] = mapped_column(enum_type(Priority, "priority"))
    status: Mapped[TaskStatus] = mapped_column(enum_type(TaskStatus, "task_status"))
    source: Mapped[str] = mapped_column(sa.String(32))
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    application_id: Mapped[int | None] = mapped_column(sa.ForeignKey("applications.id", ondelete="SET NULL"))
    dedupe_key: Mapped[str | None] = mapped_column(sa.String(160), unique=True)
    result: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    organization = relationship("Organization", lazy="joined")
    assignee = relationship("User", foreign_keys=[assignee_id], lazy="joined")


class StatusChange(Base):
    """История смены статусов заявок и задач."""

    __tablename__ = "status_changes"
    __table_args__ = (sa.Index("ix_status_changes_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(sa.String(16))
    entity_id: Mapped[int] = mapped_column()
    from_status: Mapped[str | None] = mapped_column(sa.String(32))
    to_status: Mapped[str] = mapped_column(sa.String(32))
    actor_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))
    comment: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    actor = relationship("User", lazy="joined")
