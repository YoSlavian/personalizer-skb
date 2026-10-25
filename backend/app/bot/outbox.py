"""Доставка уведомлений в Telegram (outbox).

- уведомление «захватывается» атомарным UPDATE pending→sending, поэтому два процесса не отправят его дважды;
- временная недоступность Telegram (сеть, 5xx, RetryAfter) → статус retry с экспоненциальной задержкой, до 5 попыток;
- пользователь заблокировал бота или чат не найден → failed без повторов;
- зависшие в sending дольше 5 минут возвращаются в retry.
"""

import asyncio
import logging
from datetime import timedelta

from aiogram import Bot
from aiogram.exceptions import (
    TelegramAPIError,
    TelegramBadRequest,
    TelegramForbiddenError,
    TelegramNetworkError,
    TelegramRetryAfter,
    TelegramServerError,
)
from sqlalchemy import delete, select, update

from app import db as dbmod
from app.bot.handlers import render_notification
from app.db import utcnow
from app.models import Notification, ProcessedUpdate, TelegramLink
from app.services.notifications import MAX_TG_ATTEMPTS, pending_telegram

log = logging.getLogger("bot.outbox")


async def _claim(notification_id: int) -> bool:
    async with dbmod.session_factory()() as s:
        res = await s.execute(
            update(Notification)
            .where(Notification.id == notification_id, Notification.tg_status.in_(["pending", "retry"]))
            .values(tg_status="sending", tg_attempts=Notification.tg_attempts + 1, tg_sent_at=utcnow())
        )
        await s.commit()
        return res.rowcount == 1


async def deliver_one(bot: Bot, notification_id: int) -> str:
    if not await _claim(notification_id):
        return "skipped"
    async with dbmod.session_factory()() as s:
        n = await s.get(Notification, notification_id)
        links = list((await s.execute(select(TelegramLink).where(TelegramLink.user_id == n.user_id))).scalars())
        if not links:
            n.tg_status, n.tg_error = "skipped", "Telegram не привязан"
            await s.commit()
            return n.tg_status
        text, markup = await render_notification(s, n)
        sent, error, permanent = 0, None, False
        for link in links:
            try:
                await bot.send_message(link.chat_id, text, reply_markup=markup, disable_web_page_preview=True)
                sent += 1
            except TelegramRetryAfter as e:
                error = f"retry_after {e.retry_after}s"
                break
            except TelegramForbiddenError:
                error, permanent = "Пользователь заблокировал бота", True
            except TelegramBadRequest as e:
                error, permanent = f"bad_request: {e.message[:200]}", True
            except (TelegramNetworkError, TelegramServerError) as e:
                error = f"network: {type(e).__name__}"
            except TelegramAPIError as e:  # например, неверный токен: повторим ограниченное число раз
                error = f"api: {type(e).__name__}"
        if sent:
            n.tg_status, n.tg_error = "sent", None
        elif permanent or n.tg_attempts >= MAX_TG_ATTEMPTS:
            n.tg_status, n.tg_error = "failed", error
        else:
            n.tg_status, n.tg_error = "retry", error
        n.tg_sent_at = utcnow()
        await s.commit()
        return n.tg_status


async def process_once(bot: Bot) -> int:
    async with dbmod.session_factory()() as s:
        await s.execute(
            update(Notification).where(Notification.tg_status == "sending", Notification.tg_sent_at < utcnow() - timedelta(minutes=5)).values(tg_status="retry")
        )
        await s.commit()
        ids = [n.id for n in await pending_telegram(s)]
    for nid in ids:
        await deliver_one(bot, nid)
    return len(ids)


async def cleanup_processed_updates() -> None:
    async with dbmod.session_factory()() as s:
        await s.execute(delete(ProcessedUpdate).where(ProcessedUpdate.processed_at < utcnow() - timedelta(days=7)))
        await s.commit()


async def outbox_loop(bot: Bot, interval: float) -> None:
    cycles = 0
    while True:
        try:
            await process_once(bot)
            cycles += 1
            if cycles % 1800 == 0:
                await cleanup_processed_updates()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("Ошибка цикла доставки уведомлений")
        await asyncio.sleep(interval)
