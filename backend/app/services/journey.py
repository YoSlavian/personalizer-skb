"""Сессии адаптивного пути клиента: события → триггеры движка → адаптации и побочные действия (черновик, задача КМ, расчёт ФД)."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import utcnow
from app.engine.catalog import PRODUCTS, ROLES
from app.engine.journey import JourneyState, active_adaptations, apply_event
from app.errors import Forbidden, NotFound, ValidationFailed
from app.models import JourneyEvent, JourneySession, User
from app.models.enums import AbVariant, AppSource, NotificationKind, Priority, TaskKind, UserRole
from app.services.access import client_contact, get_org
from app.services.applications import upsert_draft
from app.services.notifications import notify
from app.services.profiles import infer_role
from app.services.rules import active_rules
from app.services.tasks import create_task


def _role_lpr(role: str | None) -> bool:
    return True if role is None else ROLES[role].lpr


async def start_session(session: AsyncSession, user: User, *, product_code: str, communication_id: int | None, source: str,
                        adapt: bool | None) -> tuple[JourneySession, dict]:
    if user.role != UserRole.client:
        raise Forbidden("Путь клиента доступен только клиенту")
    if product_code not in PRODUCTS:
        raise ValidationFailed("Неизвестный продукт")
    if source not in ("web", "miniapp"):
        raise ValidationFailed("Неизвестный источник")
    contact = await client_contact(session, user)
    org = await get_org(session, user, contact.org_id)
    variant = org.effective_variant
    user_pref = user.settings.adaptive_hints if user.settings else True
    effective = variant == AbVariant.test and user_pref
    if adapt is not None and get_settings().demo_mode:
        effective = adapt  # демо-переключатель «адаптация вкл/выкл» для сравнения
    js = JourneySession(user_id=user.id, org_id=org.id, product_code=product_code, communication_id=communication_id, source=source,
                        adapt=effective, variant=variant, state=JourneyState(screen="home").to_dict())
    session.add(js)
    await session.flush()
    return js, await journey_config(session)


async def journey_config(session: AsyncSession) -> dict:
    _, cfg = await active_rules(session)
    s = get_settings()
    return {
        "idle_seconds": s.journey_idle_seconds if s.demo_mode else cfg.journey.idle_seconds,
        "returns_threshold": cfg.journey.returns_threshold,
        "recalc_threshold": cfg.journey.recalc_threshold,
        "quick_seconds": cfg.journey.quick_seconds,
    }


async def get_session_for(session: AsyncSession, user: User, session_id: int) -> JourneySession:
    js = (await session.execute(select(JourneySession).where(JourneySession.id == session_id, JourneySession.user_id == user.id))).scalar_one_or_none()
    if js is None:
        raise NotFound("Сессия не найдена")
    return js


def session_payload(js: JourneySession, role_lpr: bool, new: list[dict] | None = None, extra: dict | None = None) -> dict[str, Any]:
    st = JourneyState.from_dict(js.state)
    return {
        "id": js.id,
        "product_code": js.product_code,
        "adapt": js.adapt,
        "variant": js.variant.value,
        "outcome": js.outcome,
        "metrics": {
            "elapsed_sec": int(((js.finished_at or utcnow()) - js.started_at).total_seconds()),
            "time_to_apply_sec": js.time_to_apply_sec,
            "steps": js.steps,
            "returns": js.returns,
            "recalcs": js.recalcs,
            "hints_shown": js.hints_shown,
            "hints_closed": js.hints_closed,
        },
        "screen": st.screen,
        "log": list(reversed(st.log[-20:])),
        "active": active_adaptations(st, js.adapt, role_lpr),
        "new": new or [],
        **(extra or {}),
    }


async def handle_event(session: AsyncSession, user: User, session_id: int, *, kind: str, screen: str | None, action: str | None,
                       meta: dict[str, Any]) -> dict[str, Any]:
    js = await get_session_for(session, user, session_id)
    if js.outcome == "applied" and kind != "view":
        raise ValidationFailed("Сессия завершена заявкой")
    _, cfg = await active_rules(session)
    contact = await client_contact(session, user, js.org_id)
    role = infer_role(contact).role
    role_lpr = _role_lpr(role)
    st = JourneyState.from_dict(js.state)
    now = utcnow()
    try:
        res = apply_event(st, kind=kind, screen=screen, action=action, now=now, started_at=js.started_at, last_event_at=js.last_event_at,
                          adapt=js.adapt, role_lpr=role_lpr, cfg=cfg, idle_seconds=(await journey_config(session))["idle_seconds"])
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    js.state = st.to_dict()
    js.steps, js.returns, js.recalcs = st.steps, st.returns, st.recalcs
    js.hints_shown, js.hints_closed = st.hints_shown, st.hints_closed
    js.last_event_at = now
    safe_meta = {str(k)[:32]: v for k, v in list(meta.items())[:10] if isinstance(v, (int, float, str, bool)) and len(str(v)) <= 200}
    session.add(JourneyEvent(session_id=js.id, kind=kind, screen=screen, meta=safe_meta | ({"action": action} if action else {}), created_at=now))

    extra: dict[str, Any] = {}
    org = await get_org(session, user, js.org_id)
    product = PRODUCTS[js.product_code]
    try:
        amount = int(meta.get("amount_rub") or 20_000_000)
        term = int(meta.get("term_months") or 12)
    except (TypeError, ValueError) as e:
        raise ValidationFailed("Некорректные параметры расчёта") from e
    for effect in res.side_effects:
        if effect == "save_draft" and product.calculable:
            draft = await upsert_draft(session, user, js.org_id, js.product_code, amount, term,
                                       AppSource.miniapp if js.source == "miniapp" else AppSource.web, js.id)
            extra["draft_id"] = draft.id
        elif effect == "ask_manager":
            task, created = await create_task(
                session, org=org, kind=TaskKind.hesitation, title=f"Клиент сомневается в расчёте: {product.name}",
                description=f"Сигналы сессии: пересчётов {js.recalcs}, возвратов на витрину {js.returns}. Клиент попросил связаться. "
                            f"Расчёт: {amount / 1e6:.1f} млн ₽ на {term} мес.",
                priority=Priority.high, due_hours=4, source="journey", actor_id=user.id, dedupe_key=f"hesitation:{js.id}", now=now)
            extra["task_id"] = task.id
            extra["message"] = "Менеджер получил задачу и свяжется с вами" if created else "Запрос уже передан менеджеру"
        elif effect == "send_fd":
            fd_users = [c.user_id for c in org.contacts if c.user_id and c.user_id != user.id and infer_role(c).role in ("fd", "owner")]
            if fd_users:
                await notify(session, fd_users, kind=NotificationKind.offer, title=f"Расчёт от коллеги: {product.name}",
                             # Суммы и сроки — только в кабинете: текст для Telegram без них собирает bot.handlers (tg_payload type calc)
                             body=f"{amount / 1e6:.1f} млн ₽ на {term} мес. Откройте расчёт и примите решение в кабинете.",
                             link=f"/journey?product={js.product_code}", entity_type="journey", entity_id=js.id,
                             tg_payload={"type": "calc", "product": js.product_code})
                extra["message"] = "Расчёт отправлен финансовому директору"
            else:
                await create_task(session, org=org, kind=TaskKind.hesitation, title=f"Передать расчёт ЛПР: {product.name}",
                                  description="Бухгалтер подготовил расчёт, ЛПР в кабинете не найден — передайте расчёт лично.",
                                  priority=Priority.normal, due_hours=24, source="journey", actor_id=user.id, dedupe_key=f"send_fd:{js.id}", now=now)
                extra["message"] = "ЛПР не подключён к кабинету: менеджер передаст расчёт"
        elif effect == "save":
            extra["message"] = "Расчёт сохранён"
    await session.flush()
    return session_payload(js, role_lpr, res.new, extra)
