"""Уведомления: веб-центр уведомлений + outbox для доставки в Telegram (пользовательские настройки учитываются)."""

from collections.abc import Iterable
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.errors import NotFound
from app.models import Notification, User
from app.models.enums import NotificationKind

_KIND_SETTING = {
    NotificationKind.application: "notify_applications",
    NotificationKind.task: "notify_tasks",
    NotificationKind.offer: "notify_offers",
}
MAX_TG_ATTEMPTS = 5


def wants_telegram(user: User, kind: NotificationKind) -> bool:
    if not user.telegram_links:
        return False
    s = user.settings
    if s is None:
        return True
    if not s.notify_telegram:
        return False
    attr = _KIND_SETTING.get(kind)
    return bool(getattr(s, attr)) if attr else True


async def notify(
    session: AsyncSession,
    user_ids: Iterable[int | None],
    *,
    kind: NotificationKind,
    title: str,
    body: str = "",
    link: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    tg_payload: dict[str, Any] | None = None,
    exclude: int | None = None,
) -> list[Notification]:
    ids = {i for i in user_ids if i is not None and i != exclude}
    if not ids:
        return []
    users = (await session.execute(select(User).where(User.id.in_(ids), User.is_active.is_(True)))).scalars().all()
    out = []
    for u in users:
        n = Notification(
            user_id=u.id,
            kind=kind,
            title=title[:200],
            body=body,
            link=link,
            entity_type=entity_type,
            entity_id=entity_id,
            tg_status="pending" if wants_telegram(u, kind) else "skipped",
            tg_payload=tg_payload,
        )
        session.add(n)
        out.append(n)
    await session.flush()
    return out


async def list_for(session: AsyncSession, user: User, *, unread_only: bool, page: int, size: int) -> tuple[list[Notification], int]:
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.is_read.is_(False))
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await session.execute(q.order_by(Notification.created_at.desc(), Notification.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return list(items), total


async def unread_count(session: AsyncSession, user: User) -> int:
    return (
        await session.execute(select(func.count()).where(Notification.user_id == user.id, Notification.is_read.is_(False)))
    ).scalar_one()


async def mark_read(session: AsyncSession, user: User, notification_id: int) -> Notification:
    n = (await session.execute(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))).scalar_one_or_none()
    if n is None:
        raise NotFound("Уведомление не найдено")
    n.is_read = True
    return n


async def mark_all_read(session: AsyncSession, user: User) -> int:
    res = await session.execute(update(Notification).where(Notification.user_id == user.id, Notification.is_read.is_(False)).values(is_read=True))
    return res.rowcount or 0


async def pending_telegram(session: AsyncSession, limit: int = 20) -> list[Notification]:
    """Уведомления для отправки: новые и неудачные с экспоненциальной задержкой повтора."""
    now = utcnow()
    rows = (
        await session.execute(
            select(Notification)
            .where(Notification.tg_status.in_(["pending", "retry"]), Notification.tg_attempts < MAX_TG_ATTEMPTS)
            .order_by(Notification.id)
            .limit(limit * 3)
        )
    ).scalars()
    due = []
    for n in rows:
        backoff = timedelta(seconds=min(300, 5 * 2 ** max(0, n.tg_attempts - 1))) if n.tg_attempts else timedelta(0)
        last = n.tg_sent_at or n.created_at
        if n.tg_status == "pending" or now - last >= backoff:
            due.append(n)
        if len(due) >= limit:
            break
    return due
