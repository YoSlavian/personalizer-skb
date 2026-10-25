from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow
from app.models.enums import AbVariant, BalanceKind, ConsentChannel, IbRights, Industry, Position, SignalKind
from app.models.types import UTCDateTime, enum_type


class CompanyGroup(Base):
    """Группа компаний (холдинг). A/B-вариант назначается на всю группу."""

    __tablename__ = "company_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(200), unique=True)
    ab_variant: Mapped[AbVariant] = mapped_column(enum_type(AbVariant, "ab_variant"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    # Состав группы загружается явным запросом (services.orgs.group_members), чтобы не тянуть граф целиком
    organizations: Mapped[list["Organization"]] = relationship(back_populates="group", lazy="raise")


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        sa.CheckConstraint("revenue_mln >= 0", name="revenue_non_negative"),
        sa.CheckConstraint("logins_30d >= 0 AND logins_30d <= 1000", name="logins_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(sa.String(200), index=True)
    inn: Mapped[str] = mapped_column(sa.String(12), unique=True)
    group_id: Mapped[int | None] = mapped_column(sa.ForeignKey("company_groups.id", ondelete="SET NULL"), index=True)
    head_of_group: Mapped[bool] = mapped_column(default=False)
    industry: Mapped[Industry] = mapped_column(enum_type(Industry, "industry"), index=True)
    okved: Mapped[str | None] = mapped_column(sa.String(16))
    revenue_mln: Mapped[int] = mapped_column(sa.Integer)
    # Обороты РКО по месяцам (12 значений, млн ₽) — источник сезонного цикла
    turnover_by_month: Mapped[list[float]] = mapped_column(sa.JSON)
    seasonal: Mapped[bool] = mapped_column(default=False)
    logins_30d: Mapped[int] = mapped_column(sa.Integer, default=0)
    balance_kind: Mapped[BalanceKind | None] = mapped_column(enum_type(BalanceKind, "balance_kind"))
    manager_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    ab_variant: Mapped[AbVariant] = mapped_column(enum_type(AbVariant, "ab_variant"))
    is_synthetic: Mapped[bool] = mapped_column(default=True)
    # Из датасета кейса: id компании, подключённые продукты (флаги CL_PRODUCT_*), участие в ВЭД (FTS_FLAG)
    dataset_uid: Mapped[str | None] = mapped_column(sa.String(32), index=True)
    owned_products: Mapped[list[str]] = mapped_column(sa.JSON, default=list)
    foreign_trade: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    group: Mapped[CompanyGroup | None] = relationship(back_populates="organizations", lazy="joined")
    contacts: Mapped[list["Contact"]] = relationship(back_populates="organization", cascade="all, delete-orphan", lazy="selectin", order_by="Contact.id")
    signals: Mapped[list["Signal"]] = relationship(back_populates="organization", cascade="all, delete-orphan", lazy="selectin")
    consents: Mapped[list["Consent"]] = relationship(back_populates="organization", cascade="all, delete-orphan", lazy="selectin")
    manager = relationship("User", lazy="joined", foreign_keys=[manager_id])

    @property
    def size(self) -> str:
        return "large" if self.revenue_mln >= 10_000 else "mid"

    @property
    def effective_variant(self) -> AbVariant:
        return self.group.ab_variant if self.group else self.ab_variant


class Contact(Base):
    """ЛПР компании: роль по CRM и права в ИБ. Если контакт — пользователь кабинета, user_id заполнен (членство)."""

    __tablename__ = "contacts"
    __table_args__ = (sa.UniqueConstraint("org_id", "user_id", name="org_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(sa.String(100))
    crm_position: Mapped[Position | None] = mapped_column(enum_type(Position, "position"))
    ib_rights: Mapped[IbRights | None] = mapped_column(enum_type(IbRights, "ib_rights"))
    boss_access: Mapped[bool] = mapped_column(default=False)
    is_primary: Mapped[bool] = mapped_column(default=False)
    user_id: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    organization: Mapped[Organization] = relationship(back_populates="contacts")
    user = relationship("User", lazy="joined")


class Signal(Base):
    """Событие клиента с ограниченным сроком: валютный платёж, окончание депозита, запрос в БКИ."""

    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    kind: Mapped[SignalKind] = mapped_column(enum_type(SignalKind, "signal_kind"))
    note: Mapped[str | None] = mapped_column(sa.String(200))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    created_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    organization: Mapped[Organization] = relationship(back_populates="signals")


class Consent(Base):
    """Отказ от маркетинговых коммуникаций по каналу (или от всех). Сервисные уведомления не затрагиваются."""

    __tablename__ = "consents"
    __table_args__ = (sa.UniqueConstraint("org_id", "channel", name="org_channel"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(sa.ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    channel: Mapped[ConsentChannel] = mapped_column(enum_type(ConsentChannel, "consent_channel"))
    opted_out: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    updated_by: Mapped[int | None] = mapped_column(sa.ForeignKey("users.id", ondelete="SET NULL"))

    organization: Mapped[Organization] = relationship(back_populates="consents")
