"""Middleware бота: защита от повторной обработки update, сессия БД и пользователь по подтверждённому Telegram ID."""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, Update
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import db as dbmod
from app.models import ProcessedUpdate, TelegramLink

log = logging.getLogger("bot")


class DedupMiddleware(BaseMiddleware):
    """Telegram может повторно доставить update (ретраи вебхука, перезапуск polling). Обрабатываем каждый update_id один раз."""

    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]], event: TelegramObject, data: dict[str, Any]) -> Any:
        if isinstance(event, Update):
            async with dbmod.session_factory()() as session:
                session.add(ProcessedUpdate(update_id=event.update_id))
                try:
                    await session.commit()
                except IntegrityError:
                    await session.rollback()
                    log.info("update %s уже обработан, пропускаем", event.update_id)
                    return None
        return await handler(event, data)


class DbUserMiddleware(BaseMiddleware):
    """Открывает сессию БД на update и находит пользователя по привязке Telegram. Коммит — после успешной обработки."""

    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]], event: TelegramObject, data: dict[str, Any]) -> Any:
        tg_user = data.get("event_from_user")
        async with dbmod.session_factory()() as session:
            data["db"] = session
            data["user"] = None
            if tg_user is not None:
                link = (await session.execute(select(TelegramLink).where(TelegramLink.telegram_user_id == tg_user.id))).scalar_one_or_none()
                if link and link.user.is_active:
                    data["user"] = link.user
                    data["link"] = link
            try:
                result = await handler(event, data)
                await session.commit()
                return result
            except Exception:
                await session.rollback()
                raise
