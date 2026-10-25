"""Заявки клиентов: создание (кабинет, Mini App, бот, менеджер), статусы, комментарии, атрибуция к коммуникации."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.engine.catalog import PRODUCTS
from app.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import Application, ApplicationComment, JourneySession, Organization, StatusChange, User
from app.models.enums import AppSource, AppStatus, NotificationKind, Priority, TaskKind, UserRole
from app.services.access import client_org_ids, get_org, org_scope
from app.services.audit import audit
from app.services.communications import attribute_conversion
from app.services.notifications import notify
from app.services.tasks import close_application_tasks, create_task

STATUS_NAMES = {
    AppStatus.draft: "Черновик",
    AppStatus.submitted: "Отправлена",
    AppStatus.in_review: "На рассмотрении",
    AppStatus.needs_info: "Нужны уточнения",
    AppStatus.approved: "Одобрена",
    AppStatus.declined: "Отказ",
    AppStatus.cancelled: "Отменена",
}
CLIENT_TRANSITIONS = {
    AppStatus.draft: {AppStatus.submitted, AppStatus.cancelled},
    AppStatus.submitted: {AppStatus.cancelled},
    AppStatus.needs_info: {AppStatus.in_review, AppStatus.cancelled},
}
STAFF_TRANSITIONS = {
    AppStatus.submitted: {AppStatus.in_review, AppStatus.declined},
    AppStatus.in_review: {AppStatus.needs_info, AppStatus.approved, AppStatus.declined},
    AppStatus.needs_info: {AppStatus.in_review, AppStatus.declined},
}
FINAL = {AppStatus.approved, AppStatus.declined, AppStatus.cancelled}
MAX_AMOUNT = 100_000_000_000


def _validate(product_code: str, amount_rub: int, term_months: int, comment: str | None) -> None:
    if product_code not in PRODUCTS:
        raise ValidationFailed("Неизвестный продукт", details=[{"loc": "product_code", "msg": "Выберите продукт из списка"}])
    errors = []
    if not 100_000 <= amount_rub <= MAX_AMOUNT:
        errors.append({"loc": "amount_rub", "msg": "Сумма от 100 тыс. до 100 млрд ₽"})
    if not 1 <= term_months <= 360:
        errors.append({"loc": "term_months", "msg": "Срок от 1 до 360 месяцев"})
    if comment and len(comment) > 2000:
        errors.append({"loc": "comment", "msg": "Комментарий не длиннее 2000 символов"})
    if errors:
        raise ValidationFailed("Проверьте параметры заявки", details=errors)


async def get_application(session: AsyncSession, user: User, app_id: int) -> Application:
    a = (await session.execute(select(Application).where(Application.id == app_id, org_scope(user, Application.org_id)))).scalar_one_or_none()
    if a is None:
        raise NotFound("Заявка не найдена")
    if user.role == UserRole.client and a.status == AppStatus.draft and a.created_by != user.id:
        raise NotFound("Заявка не найдена")
    return a


async def _client_users(session: AsyncSession, org: Organization) -> list[int]:
    return [c.user_id for c in org.contacts if c.user_id]


async def _on_submitted(session: AsyncSession, a: Application, org: Organization, actor: User) -> None:
    a.submitted_at = utcnow()
    a.assignee_id = a.assignee_id or org.manager_id
    product = PRODUCTS[a.product_code].name
    await create_task(
        session,
        org=org,
        kind=TaskKind.application_review,
        title=f"Рассмотреть заявку {a.number}: {product}",
        description=f"{a.amount_rub / 1e6:.1f} млн ₽ на {a.term_months} мес. Источник: {a.source.value}.",
        priority=Priority.high,
        due_hours=48,
        source="application",
        actor_id=actor.id,
        assignee_id=a.assignee_id,
        application_id=a.id,
        dedupe_key=f"application_review:{a.id}",
    )
    comm = await attribute_conversion(session, org.id, a.product_code, a.communication_id)
    if comm:
        a.communication_id = comm.id


async def create_application(
    session: AsyncSession,
    user: User,
    *,
    org_id: int | None,
    product_code: str,
    amount_rub: int,
    term_months: int,
    comment: str | None,
    source: AppSource,
    communication_id: int | None = None,
    journey_session_id: int | None = None,
    draft: bool = False,
    ip: str | None = None,
) -> Application:
    _validate(product_code, amount_rub, term_months, comment)
    if user.role == UserRole.client:
        ids = await client_org_ids(session, user)
        if org_id is None:
            if not ids:
                raise Forbidden("Пользователь не привязан к организации")
            org_id = ids[0]
        if org_id not in ids:
            raise NotFound("Организация не найдена")
    elif user.role == UserRole.manager:
        if org_id is None:
            raise ValidationFailed("Укажите организацию")
        source = AppSource.manager if source == AppSource.web else source
        draft = False
    else:
        raise Forbidden("Заявку создаёт клиент или его менеджер")
    org = await get_org(session, user, org_id)

    now = utcnow()
    a = Application(
        number="—",
        org_id=org.id,
        created_by=user.id,
        product_code=product_code,
        amount_rub=amount_rub,
        term_months=term_months,
        comment=(comment or "").strip() or None,
        status=AppStatus.draft if draft else AppStatus.submitted,
        source=source,
        communication_id=communication_id,
        created_at=now,
        updated_at=now,
    )
    session.add(a)
    await session.flush()
    a.number = f"З-{now.year}-{a.id:06d}"
    session.add(StatusChange(entity_type="application", entity_id=a.id, from_status=None, to_status=a.status.value, actor_id=user.id, created_at=now))
    if not draft:
        await _on_submitted(session, a, org, user)
        await notify(session, [a.assignee_id], kind=NotificationKind.application, title=f"Новая заявка {a.number}",
                     body=f"{org.name}: {PRODUCTS[product_code].name}, {amount_rub / 1e6:.1f} млн ₽", link=f"/applications/{a.id}",
                     entity_type="application", entity_id=a.id, tg_payload={"type": "application", "application_id": a.id}, exclude=user.id)
    if journey_session_id:
        await _link_journey(session, user, journey_session_id, a)
    audit(session, actor_id=user.id, action="application.create", entity_type="application", entity_id=a.id, org_id=org.id,
          details={"product": product_code, "status": a.status.value, "source": source.value}, ip=ip)
    await session.flush()
    return a


async def _link_journey(session: AsyncSession, user: User, journey_session_id: int, a: Application) -> None:
    js = (await session.execute(select(JourneySession).where(JourneySession.id == journey_session_id, JourneySession.user_id == user.id))).scalar_one_or_none()
    if js is None or js.org_id != a.org_id:
        return
    js.application_id = a.id
    if a.status != AppStatus.draft and js.outcome != "applied":
        now = utcnow()
        js.outcome, js.finished_at = "applied", now
        js.time_to_apply_sec = int((now - js.started_at).total_seconds())


async def upsert_draft(session: AsyncSession, user: User, org_id: int, product_code: str, amount_rub: int, term_months: int,
                       source: AppSource, journey_session_id: int | None) -> Application:
    existing = (
        await session.execute(
            select(Application).where(Application.org_id == org_id, Application.created_by == user.id, Application.product_code == product_code,
                                      Application.status == AppStatus.draft).order_by(Application.id.desc()).limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        _validate(product_code, amount_rub, term_months, None)
        existing.amount_rub, existing.term_months, existing.updated_at = amount_rub, term_months, utcnow()
        await session.flush()
        return existing
    return await create_application(session, user, org_id=org_id, product_code=product_code, amount_rub=amount_rub, term_months=term_months,
                                    comment=None, source=source, journey_session_id=journey_session_id, draft=True)


async def update_draft(session: AsyncSession, user: User, app_id: int, *, amount_rub: int | None, term_months: int | None, comment: str | None) -> Application:
    a = await get_application(session, user, app_id)
    if user.role != UserRole.client or a.created_by != user.id:
        raise Forbidden("Черновик может менять только его автор")
    if a.status != AppStatus.draft:
        raise Conflict("Изменять можно только черновик")
    amount = amount_rub if amount_rub is not None else a.amount_rub
    term = term_months if term_months is not None else a.term_months
    _validate(a.product_code, amount, term, comment)
    a.amount_rub, a.term_months = amount, term
    if comment is not None:
        a.comment = comment.strip() or None
    a.updated_at = utcnow()
    await session.flush()
    return a


async def change_status(session: AsyncSession, user: User, app_id: int, status: AppStatus, comment: str | None, *,
                        journey_session_id: int | None = None, ip: str | None = None) -> Application:
    a = await get_application(session, user, app_id)
    if a.status == status:
        raise Conflict(f"Заявка уже в статусе «{STATUS_NAMES[status]}»", code="no_change")
    allowed = (CLIENT_TRANSITIONS if user.role == UserRole.client else STAFF_TRANSITIONS).get(a.status, set())
    if user.role == UserRole.analyst:
        raise Forbidden("Аналитик просматривает заявки, статусы меняет менеджер")
    if status not in allowed:
        raise ValidationFailed(f"Нельзя перевести заявку из «{STATUS_NAMES[a.status]}» в «{STATUS_NAMES[status]}»")
    if status in (AppStatus.declined, AppStatus.needs_info) and not (comment or "").strip():
        raise ValidationFailed("Укажите комментарий для клиента", details=[{"loc": "comment", "msg": "Обязательное поле"}])
    prev = a.status
    now = utcnow()
    a.status = status
    a.updated_at = now
    org = a.organization
    if prev == AppStatus.draft and status == AppStatus.submitted:
        await _on_submitted(session, a, org, user)
        if journey_session_id:
            await _link_journey(session, user, journey_session_id, a)
    if status in (AppStatus.approved, AppStatus.declined):
        a.decided_at = now
        await close_application_tasks(session, a.id, user.id, f"Заявка: {STATUS_NAMES[status]}")
    if status == AppStatus.cancelled:
        await close_application_tasks(session, a.id, user.id, "Заявка отменена клиентом")
    session.add(StatusChange(entity_type="application", entity_id=a.id, from_status=prev.value, to_status=status.value, actor_id=user.id,
                             comment=(comment or "").strip() or None, created_at=now))
    if comment and comment.strip():
        session.add(ApplicationComment(application_id=a.id, author_id=user.id, body=comment.strip()[:4000], internal=False, created_at=now))

    title = f"Заявка {a.number}: {STATUS_NAMES[status]}"
    body = f"{PRODUCTS[a.product_code].name}. {comment.strip() if comment else ''}".strip()
    if user.role == UserRole.client:
        await notify(session, [a.assignee_id], kind=NotificationKind.application, title=title, body=f"{org.name}. {body}",
                     link=f"/applications/{a.id}", entity_type="application", entity_id=a.id,
                     tg_payload={"type": "application", "application_id": a.id}, exclude=user.id)
    else:
        await notify(session, await _client_users(session, org), kind=NotificationKind.application, title=title, body=body,
                     link=f"/applications/{a.id}", entity_type="application", entity_id=a.id,
                     tg_payload={"type": "application", "application_id": a.id}, exclude=user.id)
    audit(session, actor_id=user.id, action="application.status", entity_type="application", entity_id=a.id, org_id=a.org_id,
          details={"from": prev.value, "to": status.value}, ip=ip)
    await session.flush()
    return a


async def assign(session: AsyncSession, user: User, app_id: int, assignee_id: int) -> Application:
    if user.role not in (UserRole.admin, UserRole.manager):
        raise Forbidden("Назначать исполнителя может менеджер или администратор")
    a = await get_application(session, user, app_id)
    if a.status in FINAL:
        raise Conflict("Заявка уже закрыта")
    if user.role == UserRole.manager and assignee_id != user.id:
        raise Forbidden("Менеджер может взять заявку только на себя")
    target = await session.get(User, assignee_id)
    if target is None or target.role not in (UserRole.manager, UserRole.admin) or not target.is_active:
        raise ValidationFailed("Исполнителем может быть только активный менеджер")
    prev = a.assignee_id
    a.assignee_id = assignee_id
    a.updated_at = utcnow()
    audit(session, actor_id=user.id, action="application.assign", entity_type="application", entity_id=a.id, org_id=a.org_id, details={"from": prev, "to": assignee_id})
    if assignee_id != user.id:
        await notify(session, [assignee_id], kind=NotificationKind.application, title=f"Вам назначена заявка {a.number}", body=a.organization.name,
                     link=f"/applications/{a.id}", entity_type="application", entity_id=a.id, tg_payload={"type": "application", "application_id": a.id})
    await session.flush()
    return a


async def add_comment(session: AsyncSession, user: User, app_id: int, body: str, internal: bool) -> ApplicationComment:
    a = await get_application(session, user, app_id)
    body = (body or "").strip()
    if not body:
        raise ValidationFailed("Комментарий пустой", details=[{"loc": "body", "msg": "Обязательное поле"}])
    if len(body) > 4000:
        raise ValidationFailed("Комментарий не длиннее 4000 символов")
    if user.role == UserRole.client and internal:
        raise Forbidden("Клиент не может оставлять внутренние комментарии")
    c = ApplicationComment(application_id=a.id, author_id=user.id, body=body, internal=internal)
    session.add(c)
    a.updated_at = utcnow()
    await session.flush()
    if not internal:
        targets = [a.assignee_id] if user.role == UserRole.client else await _client_users(session, a.organization)
        link = f"/applications/{a.id}"
        await notify(session, targets, kind=NotificationKind.application, title=f"Комментарий к заявке {a.number}", body=body[:300], link=link,
                     entity_type="application", entity_id=a.id, tg_payload={"type": "application", "application_id": a.id}, exclude=user.id)
    return c


async def comments(session: AsyncSession, user: User, app_id: int) -> list[ApplicationComment]:
    a = await get_application(session, user, app_id)
    q = select(ApplicationComment).where(ApplicationComment.application_id == a.id)
    if user.role == UserRole.client:
        q = q.where(ApplicationComment.internal.is_(False))
    return list((await session.execute(q.order_by(ApplicationComment.created_at, ApplicationComment.id))).scalars())


async def list_applications(
    session: AsyncSession, user: User, *, statuses: list[AppStatus] | None, org_id: int | None, product: str | None,
    assignee: str | None, search: str | None, page: int, size: int, sort: str,
) -> tuple[list[Application], int]:
    q = select(Application).where(org_scope(user, Application.org_id))
    if user.role == UserRole.client:
        q = q.where(or_(Application.status != AppStatus.draft, Application.created_by == user.id))
    else:
        q = q.where(Application.status != AppStatus.draft)
    if statuses:
        q = q.where(Application.status.in_(statuses))
    if org_id:
        q = q.where(Application.org_id == org_id)
    if product:
        q = q.where(Application.product_code == product)
    if assignee == "me":
        q = q.where(Application.assignee_id == user.id)
    if search:
        like = f"%{search.strip()[:100]}%"
        q = q.join(Organization, Organization.id == Application.org_id).where(or_(Application.number.ilike(like), Organization.name.ilike(like)))
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    order = {
        "-created": [Application.created_at.desc()],
        "created": [Application.created_at.asc()],
        "-amount": [Application.amount_rub.desc()],
        "-updated": [Application.updated_at.desc()],
    }.get(sort, [Application.created_at.desc()])
    items = (await session.execute(q.order_by(*order, Application.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return list(items), total
