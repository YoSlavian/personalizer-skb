"""Кабинет клиента: персональное предложение на главной (под роль пользователя), витрина, черновики."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.engine.catalog import PRODUCTS, ROLES, industry_name
from app.engine.decide import visual_data
from app.engine.profile import Offer
from app.models import Application, Communication, User
from app.models.enums import AbVariant, AppStatus, Channel, CommStatus
from app.services.access import client_contact, get_org
from app.services.communications import active_placement
from app.services.decisions import DecisionBundle, decide_for_org
from app.services.delivery import make_comm
from app.services.orgs import consent_map


def _why(b: DecisionBundle) -> str:
    r, p = b.result, b.profile
    if b.variant == AbVariant.control or r.fallback:
        return "Предложение банка для бизнеса."
    parts = []
    if p.industry != "unk":
        parts.append(f"отрасли ({industry_name(p.industry)})")
    if r.winner and r.winner.why:
        parts.append(", ".join(r.winner.why))
    if r.role_name:
        parts.append(f"вашей роли ({r.role_name.lower()})")
    if p.structure == "group":
        parts.append("структуре группы компаний")
    return ("Подобрано по " + ", ".join(parts) + ".") if parts else "Подобрано по профилю компании."


def _offer_for(b: DecisionBundle) -> tuple[Offer | None, Channel]:
    r = b.result
    if b.variant == AbVariant.control:
        ac = r.as_is
        if r.suppressed:
            return None, Channel.banner_ib
        return Offer(product_code=ac.product_code, product_name=ac.product_name, headline=ac.headline,
                     body="Финансирование для вашего бизнеса. Рассчитайте условия онлайн.", cta="Рассчитать условия",
                     visual=PRODUCTS[ac.product_code].visual), Channel.banner_ib
    if not r.offer:
        return None, Channel.banner_ib
    codes = [c.code for c in r.channels]
    if "fx_placement" in codes:
        ch = Channel.fx_placement
    elif "boss" in codes:
        ch = Channel.boss
    else:
        ch = Channel.banner_ib
    return r.offer, ch


async def home(session: AsyncSession, user: User) -> dict[str, Any]:
    contact = await client_contact(session, user)
    org = await get_org(session, user, contact.org_id)
    b = await decide_for_org(session, org, contact=contact)
    offer, channel = _offer_for(b)
    decision_org = b.built.org
    placement = None
    if offer:
        comm = await active_placement(session, decision_org.id, offer.product_code)
        if comm is None:
            now = utcnow()
            comm = make_comm(org=decision_org, variant=b.variant, offer=offer, channel=channel,
                             recipient=b.result.role_name or b.result.recipient, decision_id=None, run_id=None, now=now)
            session.add(comm)
            await session.flush()
        if comm.shown_at is None:
            comm.shown_at = utcnow()
        if comm.status == CommStatus.planned:
            comm.status = CommStatus.shown
        placement = {
            "communication_id": comm.id,
            "channel": comm.channel.value,
            "product_code": offer.product_code,
            "product_name": offer.product_name,
            "headline": comm.headline,
            "body": comm.body,
            "cta": comm.cta,
            "visual": comm.visual,
            "visual_data": visual_data(b.profile, comm.visual),
            "why": _why(b),
            "calculable": PRODUCTS[offer.product_code].calculable,
        }

    drafts = (
        await session.execute(
            select(Application).where(Application.created_by == user.id, Application.status == AppStatus.draft).order_by(Application.updated_at.desc()).limit(3)
        )
    ).scalars().all()
    recent = (
        await session.execute(
            select(Application).where(Application.org_id == org.id, Application.status != AppStatus.draft).order_by(Application.updated_at.desc()).limit(5)
        )
    ).scalars().all()
    role = b.built.role_inference
    await session.flush()
    return {
        "organization": {"id": org.id, "name": org.name, "industry": org.industry.value, "industry_name": industry_name(org.industry.value),
                         "group": org.group.name if org.group else None, "manager": org.manager.full_name if org.manager else None},
        "role": {"code": role.role, "name": ROLES[role.role].name if role.role else "Не указана", "source": role.source},
        "variant": b.variant.value,
        "offer": placement,
        "suppressed": b.result.suppressed,
        "routing": b.result.routing if b.variant == AbVariant.test else None,
        "drafts": drafts,
        "applications": recent,
        "consents": consent_map(org),
        "synthetic_balance": "99 999,61 ₽",
    }


async def showcase(session: AsyncSession, user: User, product: str | None = None) -> dict[str, Any]:
    contact = await client_contact(session, user)
    org = await get_org(session, user, contact.org_id)
    b = await decide_for_org(session, org, contact=contact)
    offer, _ = _offer_for(b)
    if b.variant == AbVariant.control:
        order = ["working", "leasing", "deposit", "factoring"]
        items = [{"code": c, "name": PRODUCTS[c].name, "recommended": False, "calculable": PRODUCTS[c].calculable, "why": []} for c in order]
    else:
        # Стоп-кран и пауза ограничивают маркетинговые показы, а не витрину: продукт, с которого клиент пришёл, остаётся первым
        first = product if product in PRODUCTS and PRODUCTS[product].calculable else offer.product_code if offer else None
        rows = [x for x in b.result.rows if (x.total > 0 or x.code == first) and PRODUCTS[x.code].calculable]
        if first and PRODUCTS[first].calculable:
            rows.sort(key=lambda x: x.code != first)
        items = [{"code": x.code, "name": x.name, "recommended": i == 0, "calculable": True, "why": x.why} for i, x in enumerate(rows[:4])]
        if not any(i["code"] == "deposit" for i in items) and len(items) < 4:
            items.append({"code": "deposit", "name": PRODUCTS["deposit"].name, "recommended": False, "calculable": True, "why": []})
    return {"variant": b.variant.value, "items": items, "offer_product": offer.product_code if offer else None}


async def placement_for_comm(session: AsyncSession, comm_id: int) -> Communication | None:
    return await session.get(Communication, comm_id)
