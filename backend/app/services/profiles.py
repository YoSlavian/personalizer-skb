"""Сборка профиля клиента (признаков ML-модели) из данных CRM, РКО, ИБ и истории коммуникаций.

Правила работы с данными из решения команды:
- пропуски не удаляем: «Не указано» / «Не определена» — отдельные категории;
- CRM ≠ модель: заявленная роль (CRM) и выведенная по правам в ИБ хранятся раздельно, у выведенной вес ниже;
- обороты РКО по месяцам → месяц пика и недели до пика.
"""

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.engine.policy import HistoryItem, hidden_products, stopped_products, window_start
from app.engine.profile import ClientProfile, GroupEntity, GroupInfo
from app.engine.rules import RulesConfig
from app.models import Communication, Contact, Organization
from app.models.enums import ConsentChannel, IbRights


@dataclass(frozen=True)
class RoleInference:
    role: str | None
    source: str  # crm | inferred | none
    explanation: str


def infer_role(contact: Contact | None) -> RoleInference:
    if contact is None:
        return RoleInference(None, "none", "Контакт ЛПР не найден")
    if contact.crm_position:
        return RoleInference(contact.crm_position.value, "crm", "Должность заполнена в CRM")
    if contact.ib_rights is None:
        return RoleInference(None, "none", "В CRM пусто, пользователя ИБ нет: роль не указана")
    first = contact.ib_rights == IbRights.first_signature
    if contact.boss_access and first:
        role = "owner"
    elif contact.boss_access:
        role = "fd"
    elif first:
        role = "owner"
    elif contact.ib_rights == IbRights.second_signature:
        role = "acc"
    else:
        role = "ops"
    rights = {"first_signature": "первая подпись", "second_signature": "вторая подпись", "none": "без права подписи"}[contact.ib_rights.value]
    return RoleInference(role, "inferred", f"В CRM пусто: выведено по правам в ИБ ({rights}{', доступ к Альфа-Босс' if contact.boss_access else ''})")


def primary_contact(org: Organization) -> Contact | None:
    return next((c for c in org.contacts if c.is_primary), org.contacts[0] if org.contacts else None)


def weeks_to_peak(turnover: list[float], today: date) -> tuple[int, int]:
    """Месяц пика оборотов РКО (1–12) и сколько полных недель до его начала (0 — пик уже идёт)."""
    peak_month = turnover.index(max(turnover)) + 1
    if today.month == peak_month:
        return peak_month, 0
    year = today.year if peak_month > today.month else today.year + 1
    return peak_month, min(52, max(0, (date(year, peak_month, 1) - today).days // 7))


def turnover_total(org: Organization) -> float:
    return float(sum(org.turnover_by_month or [0]))


async def group_members(session: AsyncSession, group_id: int) -> list[Organization]:
    q = select(Organization).where(Organization.group_id == group_id).order_by(Organization.head_of_group.desc(), Organization.id)
    return list((await session.execute(q)).scalars())


def group_info(members: list[Organization]) -> GroupInfo:
    total = sum(turnover_total(o) for o in members) or 1.0
    raw = [turnover_total(o) / total * 100 for o in members]
    shares = [round(x) for x in raw]
    # Доли округляются так, чтобы в сумме было 100%
    if shares:
        shares[raw.index(max(raw))] += 100 - sum(shares)
    group_name = members[0].group.name if members and members[0].group else "Группа"
    return GroupInfo(
        name=group_name,
        entities=[
            GroupEntity(
                name=o.name + (" (головная)" if o.head_of_group else ""),
                industry=o.industry.value,
                share=max(0, s),
                balance=(o.balance_kind.value if o.balance_kind else "surplus"),
                org_id=o.id,
                head=o.head_of_group,
            )
            for o, s in zip(members, shares, strict=True)
        ],
    )


async def history_for(session: AsyncSession, org_ids: list[int], since: datetime) -> list[HistoryItem]:
    rows = (
        await session.execute(
            select(Communication).where(Communication.org_id.in_(org_ids), Communication.created_at >= since).order_by(Communication.created_at.desc())
        )
    ).scalars()
    return [
        HistoryItem(
            channel=c.channel.value,
            product_code=c.product_code,
            status=c.status.value,
            created_at=c.created_at,
            clicks=c.clicks,
            clicked_at=c.clicked_at,
            hidden_at=c.hidden_at,
            converted_at=c.converted_at,
        )
        for c in rows
    ]


@dataclass
class BuiltProfile:
    profile: ClientProfile
    org: Organization  # организация, от имени которой принимается решение (головная для группы)
    members: list[Organization]
    contact: Contact | None
    role_inference: RoleInference
    peak_month: int
    history: list[HistoryItem]


async def build_profile(
    session: AsyncSession, org: Organization, cfg: RulesConfig, *, contact: Contact | None = None, now: datetime | None = None
) -> BuiltProfile:
    now = now or utcnow()
    members: list[Organization] = [org]
    base = org
    if org.group_id:
        members = await group_members(session, org.group_id)
        base = next((o for o in members if o.head_of_group), members[0])
    if contact is None or contact.org_id not in {m.id for m in members}:
        contact = primary_contact(base)
    ri = infer_role(contact)
    peak_month, weeks = weeks_to_peak(base.turnover_by_month, now.date())

    active_signals = {s.kind.value for s in base.signals if s.expires_at > now}
    consents = {c.channel: c.opted_out for c in base.consents}
    # Для группы история общая: скрытие и «стоп-кран» действуют на всю группу
    history = await history_for(session, [m.id for m in members], window_start(now, cfg))

    is_group = bool(org.group_id) and len(members) > 1
    group_revenue = sum(m.revenue_mln for m in members)
    size = "large" if (group_revenue if is_group else base.revenue_mln) >= 10_000 else "mid"
    balances = {m.balance_kind for m in members if m.balance_kind}

    profile = ClientProfile(
        company=(base.group.name if is_group and base.group else base.name),
        industry=base.industry.value,
        seasonal=base.seasonal,
        weeks_to_peak=weeks,
        role=ri.role or "fd",
        role_source=ri.source,
        structure="group" if is_group else "solo",
        size=size,
        group=group_info(members) if is_group else None,
        mixed_balances=is_group and len(balances) > 1,
        logins_30d=base.logins_30d,
        fx_payment="fx_payment" in active_signals,
        deposit_ending="deposit_ending" in active_signals,
        bki_request="bki_request" in active_signals,
        hidden_products=hidden_products(history, now, cfg),
        stopped_products=stopped_products(history, now, cfg),
        opt_out_email=consents.get(ConsentChannel.email, False),
        opt_out_push=consents.get(ConsentChannel.push, False),
        opt_out_all=consents.get(ConsentChannel.all, False),
        turnover_by_month=[float(x) for x in base.turnover_by_month],
    )
    return BuiltProfile(profile=profile, org=base, members=members, contact=contact, role_inference=ri, peak_month=peak_month, history=history)
