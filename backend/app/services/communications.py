"""Журнал коммуникаций и реакции клиента (показ, клик, скрытие) — обратная связь для модели и «стоп-крана»."""

from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import like_pattern
from app.db import utcnow
from app.errors import NotFound, ValidationFailed
from app.models import Communication, Organization, User
from app.models.enums import PLACEMENT_CHANNELS, AbVariant, Channel, CommStatus, ConsentChannel
from app.services.access import org_scope
from app.services.audit import audit
from app.services.orgs import set_consents


async def list_communications(
    session: AsyncSession,
    user: User,
    *,
    org_id: int | None,
    channel: Channel | None,
    status: CommStatus | None,
    variant: AbVariant | None,
    product: str | None,
    run_id: int | None,
    search: str | None,
    page: int,
    size: int,
) -> tuple[list[Communication], int]:
    q = select(Communication).where(org_scope(user, Communication.org_id))
    if org_id:
        q = q.where(Communication.org_id == org_id)
    if channel:
        q = q.where(Communication.channel == channel)
    if status:
        q = q.where(Communication.status == status)
    if variant:
        q = q.where(Communication.variant == variant)
    if product:
        q = q.where(Communication.product_code == product)
    if run_id:
        q = q.where(Communication.campaign_run_id == run_id)
    if search:
        like = like_pattern(search)
        q = q.join(Organization, Organization.id == Communication.org_id).where(or_(Organization.name.ilike(like, escape="\\"), Communication.headline.ilike(like, escape="\\")))
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await session.execute(q.order_by(Communication.created_at.desc(), Communication.id.desc()).offset((page - 1) * size).limit(size))).scalars()
    return list(items), total


async def get_for_client(session: AsyncSession, user: User, comm_id: int) -> Communication:
    comm = (await session.execute(select(Communication).where(Communication.id == comm_id, org_scope(user, Communication.org_id)))).scalar_one_or_none()
    if comm is None:
        raise NotFound("Предложение не найдено")
    return comm


async def register_interaction(session: AsyncSession, user: User, comm_id: int, kind: str, *, ip: str | None = None) -> Communication:
    """Реакция клиента. Повторный показ и повторное скрытие идемпотентны; клики считаются для «стоп-крана»."""
    comm = await get_for_client(session, user, comm_id)
    now = utcnow()
    if comm.status == CommStatus.blocked:
        raise ValidationFailed("Коммуникация не была отправлена")
    if kind == "shown":
        if comm.shown_at is None:
            comm.shown_at = now
        if comm.status in (CommStatus.planned, CommStatus.sent):
            comm.status = CommStatus.shown
    elif kind == "clicked":
        comm.shown_at = comm.shown_at or now
        comm.clicked_at = now
        comm.clicks += 1
        if comm.status not in (CommStatus.converted, CommStatus.hidden):
            comm.status = CommStatus.clicked
    elif kind == "hidden":
        if comm.hidden_at is None:
            comm.hidden_at = now
            comm.status = CommStatus.hidden
            audit(session, actor_id=user.id, action="offer.hide", entity_type="communication", entity_id=comm.id, org_id=comm.org_id,
                  details={"product": comm.product_code}, ip=ip)
    elif kind == "unsubscribe_push":
        await set_consents(session, user, comm.org_id, {ConsentChannel.push: True}, ip=ip)
        if comm.hidden_at is None:
            comm.hidden_at, comm.status = now, CommStatus.hidden
    else:
        raise ValidationFailed("Неизвестный тип реакции")
    await session.flush()
    return comm


async def active_placement(session: AsyncSession, org_id: int, product_code: str | None = None) -> Communication | None:
    q = select(Communication).where(
        Communication.org_id == org_id,
        Communication.channel.in_(list(PLACEMENT_CHANNELS)),
        Communication.status.in_([CommStatus.planned, CommStatus.shown, CommStatus.clicked]),
        Communication.created_at >= utcnow() - timedelta(days=30),
    )
    if product_code:
        q = q.where(Communication.product_code == product_code)
    return (await session.execute(q.order_by(Communication.created_at.desc()).limit(1))).scalar_one_or_none()


async def attribute_conversion(session: AsyncSession, org_id: int, product_code: str, communication_id: int | None) -> Communication | None:
    """Атрибуция заявки: явная коммуникация или последний клик по этому продукту за 14 дней."""
    comm = None
    if communication_id:
        comm = (await session.execute(select(Communication).where(Communication.id == communication_id, Communication.org_id == org_id))).scalar_one_or_none()
    if comm is None:
        comm = (
            await session.execute(
                select(Communication)
                .where(Communication.org_id == org_id, Communication.product_code == product_code, Communication.clicked_at.is_not(None),
                       Communication.clicked_at >= utcnow() - timedelta(days=14))
                .order_by(Communication.clicked_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    if comm and comm.converted_at is None:
        now = utcnow()
        comm.converted_at = now
        comm.shown_at = comm.shown_at or now
        comm.status = CommStatus.converted
    return comm
