"""Доставка коммуникаций по каналам.

- баннер ИБ, Альфа-Босс, плейсмент у «Валютного перевода» → плейсмент в кабинете клиента (статус planned до показа);
- push → уведомление в Telegram привязанным пользователям организации (через outbox бота);
- email → EmailAdapter (в демо mock: письмо не уходит наружу);
- звонок КМ → задача клиентскому менеджеру.
"""

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.catalog import PRODUCTS, ROLES
from app.engine.profile import DecisionResult, Offer
from app.integrations.email import email_adapter
from app.models import Communication, Organization
from app.models.enums import PLACEMENT_CHANNELS, AbVariant, Channel, CommStatus, NotificationKind, Priority, TaskKind
from app.services.notifications import notify
from app.services.profiles import infer_role
from app.services.tasks import create_task


def make_comm(
    *,
    org: Organization,
    variant: AbVariant,
    offer: Offer,
    channel: Channel,
    recipient: str,
    decision_id: int | None,
    run_id: int | None,
    now: datetime,
) -> Communication:
    return Communication(
        campaign_run_id=run_id,
        decision_id=decision_id,
        org_id=org.id,
        group_id=org.group_id,
        variant=variant,
        product_code=offer.product_code,
        channel=channel,
        recipient=recipient[:200],
        headline=offer.headline[:300],
        body=offer.body[:1000],
        cta=offer.cta[:100],
        visual=offer.visual,
        status=CommStatus.planned,
        created_at=now,
    )


def target_users(org: Organization, result: DecisionResult | None) -> list[int]:
    """Кому из пользователей кабинета адресовать push: ЛПР-продукт — только ЛПР, иначе всем, кроме неподходящих."""
    contacts = [c for c in org.contacts if c.user_id]
    if not contacts:
        return []
    product = PRODUCTS.get(result.offer.product_code) if result and result.offer else None
    matched = []
    for c in contacts:
        role = infer_role(c).role
        if product and product.lpr and role and not ROLES[role].lpr:
            continue
        matched.append(c.user_id)
    return matched or [c.user_id for c in contacts if c.is_primary] or [contacts[0].user_id]


async def deliver(
    session: AsyncSession,
    comm: Communication,
    org: Organization,
    *,
    result: DecisionResult | None,
    actor_id: int | None,
    now: datetime,
) -> None:
    if comm.channel in PLACEMENT_CHANNELS:
        comm.status = CommStatus.planned
        return
    if comm.channel == Channel.push:
        users = target_users(org, result)
        await notify(
            session,
            users,
            kind=NotificationKind.offer,
            title=comm.headline,
            body=comm.body,
            link=f"/journey?offer={comm.id}",
            entity_type="communication",
            entity_id=comm.id,
            tg_payload={"type": "offer", "communication_id": comm.id, "cta": comm.cta, "product": comm.product_code},
        )
        comm.status, comm.sent_at = CommStatus.sent, now
        return
    if comm.channel == Channel.email:
        await email_adapter.send(recipient_ref=f"org-{org.id}:{comm.recipient}", subject=comm.headline, body=comm.body)
        comm.status, comm.sent_at = CommStatus.sent, now
        return
    if comm.channel == Channel.km_call:
        await create_task(
            session,
            org=org,
            kind=TaskKind.meeting,
            title=f"Обсудить «{PRODUCTS[comm.product_code].name}» с клиентом",
            description=f"Канал по активности клиента — менеджер. Подача: «{comm.headline}». Адресат: {comm.recipient}.",
            priority=Priority.normal,
            due_hours=24 * 7,
            source="campaign",
            actor_id=actor_id,
            dedupe_key=f"km_call:{comm.id}",
            now=now,
        )
        comm.status, comm.sent_at = CommStatus.sent, now
