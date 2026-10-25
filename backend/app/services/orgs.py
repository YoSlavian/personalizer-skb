"""Организации, контакты ЛПР, события и согласия на коммуникации."""

from datetime import timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.engine.rules import RulesConfig
from app.errors import Forbidden, NotFound, ValidationFailed
from app.models import Consent, Contact, Organization, Signal, StatusChange, Task, User
from app.models.enums import AbVariant, BalanceKind, ConsentChannel, IbRights, Industry, Position, SignalKind, TaskKind, TaskStatus, UserRole
from app.services.access import get_org, org_scope
from app.services.audit import audit

SEGMENT_FILTERS = {
    "S1": lambda cfg: Organization.group_id.is_not(None),
    "S2": lambda cfg: and_(Organization.seasonal.is_(True), Organization.industry.in_([Industry.agro, Industry.retail])),
    "S3": lambda cfg: Organization.logins_30d >= cfg.activity.high_min,
    "S4": lambda cfg: Organization.industry == Industry.trade,
}


async def list_orgs(
    session: AsyncSession,
    user: User,
    cfg: RulesConfig,
    *,
    search: str | None,
    industry: Industry | None,
    segment: str | None,
    variant: AbVariant | None,
    group_id: int | None,
    page: int,
    size: int,
    sort: str,
) -> tuple[list[Organization], int]:
    q = select(Organization).where(org_scope(user, Organization.id))
    if search:
        like = f"%{search.strip()[:100]}%"
        q = q.where(or_(Organization.name.ilike(like), Organization.inn.ilike(like)))
    if industry:
        q = q.where(Organization.industry == industry)
    if segment:
        if segment not in SEGMENT_FILTERS:
            raise ValidationFailed("Неизвестный сегмент")
        q = q.where(SEGMENT_FILTERS[segment](cfg))
    if variant:
        q = q.where(Organization.ab_variant == variant)
    if group_id:
        q = q.where(Organization.group_id == group_id)
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    order = {
        "name": [Organization.name.asc()],
        "-revenue": [Organization.revenue_mln.desc()],
        "-activity": [Organization.logins_30d.desc()],
        "-updated": [Organization.updated_at.desc()],
    }.get(sort, [Organization.name.asc()])
    items = (await session.execute(q.order_by(*order, Organization.id).offset((page - 1) * size).limit(size))).scalars().all()
    return list(items), total


async def open_task_counts(session: AsyncSession, org_ids: list[int]) -> dict[int, int]:
    if not org_ids:
        return {}
    rows = await session.execute(
        select(Task.org_id, func.count()).where(Task.org_id.in_(org_ids), Task.status.in_([TaskStatus.open, TaskStatus.in_progress])).group_by(Task.org_id)
    )
    return dict(rows.all())


ORG_FIELDS_ANALYST = {"industry", "okved", "revenue_mln", "seasonal", "logins_30d", "balance_kind", "manager_id", "ab_variant", "turnover_by_month"}


async def update_org(session: AsyncSession, user: User, org_id: int, data: dict[str, Any], *, ip: str | None = None) -> Organization:
    if user.role not in (UserRole.admin, UserRole.analyst):
        raise Forbidden("Изменять профиль компании могут аналитик и администратор")
    org = await get_org(session, user, org_id)
    changes: dict[str, Any] = {}
    for key, value in data.items():
        if key not in ORG_FIELDS_ANALYST:
            raise ValidationFailed(f"Поле нельзя изменить: {key}")
        if key == "manager_id" and value is not None:
            m = await session.get(User, value)
            if m is None or m.role != UserRole.manager or not m.is_active:
                raise ValidationFailed("Менеджером может быть только активный пользователь с ролью «менеджер»")
        if key == "ab_variant" and org.group_id:
            raise ValidationFailed("Вариант A/B для компании из группы задаётся на уровне группы")
        if key == "industry":
            value = Industry(value)
        if key == "balance_kind" and value is not None:
            value = BalanceKind(value)
        if key == "ab_variant":
            value = AbVariant(value)
        old = getattr(org, key)
        if old != value:
            changes[key] = {"from": old.value if hasattr(old, "value") else old, "to": value.value if hasattr(value, "value") else value}
            setattr(org, key, value)
    if changes:
        org.updated_at = utcnow()
        audit(session, actor_id=user.id, action="org.update", entity_type="organization", entity_id=org.id, org_id=org.id, details=changes, ip=ip)
    await session.flush()
    return org


async def update_contact(session: AsyncSession, user: User, org_id: int, contact_id: int, data: dict[str, Any], *, ip: str | None = None) -> Contact:
    if user.role == UserRole.client:
        raise Forbidden("Роль ЛПР обновляет клиентский менеджер или аналитик")
    org = await get_org(session, user, org_id)
    contact = next((c for c in org.contacts if c.id == contact_id), None)
    if contact is None:
        raise NotFound("Контакт не найден")
    changes: dict[str, Any] = {}
    if "crm_position" in data:
        v = Position(data["crm_position"]) if data["crm_position"] else None
        if v != contact.crm_position:
            changes["crm_position"] = {"from": contact.crm_position.value if contact.crm_position else None, "to": v.value if v else None}
            contact.crm_position = v
    if "ib_rights" in data:
        v = IbRights(data["ib_rights"]) if data["ib_rights"] else None
        if v != contact.ib_rights:
            changes["ib_rights"] = {"from": contact.ib_rights.value if contact.ib_rights else None, "to": v.value if v else None}
            contact.ib_rights = v
    if "boss_access" in data and data["boss_access"] is not None and bool(data["boss_access"]) != contact.boss_access:
        changes["boss_access"] = {"from": contact.boss_access, "to": bool(data["boss_access"])}
        contact.boss_access = bool(data["boss_access"])
    if data.get("is_primary") and not contact.is_primary:
        for c in org.contacts:
            c.is_primary = c.id == contact.id
        changes["is_primary"] = True
    if not changes:
        return contact
    contact.updated_at = utcnow()
    audit(session, actor_id=user.id, action="contact.update", entity_type="contact", entity_id=contact.id, org_id=org.id, details=changes, ip=ip)
    if "crm_position" in changes and contact.crm_position:
        # Роль уточнена — закрываем открытые задачи «Уточнить роль в CRM»
        now = utcnow()
        tasks = (await session.execute(select(Task).where(Task.org_id == org.id, Task.kind == TaskKind.update_crm_role,
                                                          Task.status.in_([TaskStatus.open, TaskStatus.in_progress])))).scalars()
        for t in tasks:
            session.add(StatusChange(entity_type="task", entity_id=t.id, from_status=t.status.value, to_status="done", actor_id=user.id,
                                     comment=f"Роль уточнена в CRM: {contact.crm_position.value}", created_at=now))
            t.status, t.completed_at, t.updated_at = TaskStatus.done, now, now
            t.result = f"Роль уточнена в CRM: {contact.crm_position.value}"
    await session.flush()
    return contact


async def add_signal(session: AsyncSession, user: User, org_id: int, kind: SignalKind, days: int, note: str | None, *, ip: str | None = None) -> Signal:
    if user.role == UserRole.client:
        raise Forbidden("Недостаточно прав")
    if not 1 <= days <= 90:
        raise ValidationFailed("Срок действия события — от 1 до 90 дней")
    org = await get_org(session, user, org_id)
    now = utcnow()
    sig = Signal(org_id=org.id, kind=kind, note=(note or "")[:200] or None, created_at=now, expires_at=now + timedelta(days=days), created_by=user.id)
    session.add(sig)
    await session.flush()
    audit(session, actor_id=user.id, action="signal.add", entity_type="signal", entity_id=sig.id, org_id=org.id, details={"kind": kind.value, "days": days}, ip=ip)
    return sig


async def remove_signal(session: AsyncSession, user: User, org_id: int, signal_id: int, *, ip: str | None = None) -> None:
    if user.role == UserRole.client:
        raise Forbidden("Недостаточно прав")
    org = await get_org(session, user, org_id)
    sig = next((s for s in org.signals if s.id == signal_id), None)
    if sig is None:
        raise NotFound("Событие не найдено")
    audit(session, actor_id=user.id, action="signal.remove", entity_type="signal", entity_id=sig.id, org_id=org.id, details={"kind": sig.kind.value}, ip=ip)
    await session.delete(sig)
    await session.flush()


async def set_consents(session: AsyncSession, user: User, org_id: int, values: dict[ConsentChannel, bool], *, ip: str | None = None) -> list[Consent]:
    """Отказ от коммуникаций: клиент — для своей компании, сотрудник — по обращению клиента. Всегда в журнале."""
    org = await get_org(session, user, org_id)
    existing = {c.channel: c for c in org.consents}
    changes = {}
    now = utcnow()
    for channel, opted_out in values.items():
        c = existing.get(channel)
        if c is None:
            c = Consent(org_id=org.id, channel=channel, opted_out=opted_out, updated_by=user.id, updated_at=now)
            session.add(c)
            org.consents.append(c)
            changes[channel.value] = opted_out
        elif c.opted_out != opted_out:
            c.opted_out, c.updated_by, c.updated_at = opted_out, user.id, now
            changes[channel.value] = opted_out
    if changes:
        audit(session, actor_id=user.id, action="consent.update", entity_type="organization", entity_id=org.id, org_id=org.id, details=changes, ip=ip)
    await session.flush()
    return list(org.consents)


def consent_map(org: Organization) -> dict[str, bool]:
    base = {c.value: False for c in ConsentChannel}
    base.update({c.channel.value: c.opted_out for c in org.consents})
    return base
