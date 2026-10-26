"""Запуск бота внутри процесса API: polling (локально) или webhook (сервер с HTTPS) + outbox уведомлений."""

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand, MenuButtonWebApp, Update, WebAppInfo

from app.bot.handlers import router
from app.bot.keyboards import miniapp_url
from app.bot.middlewares import DbUserMiddleware, DedupMiddleware
from app.bot.outbox import outbox_loop
from app.config import Settings

log = logging.getLogger("bot")

COMMANDS = [
    BotCommand(command="start", description="Начало и привязка аккаунта"),
    BotCommand(command="app", description="Открыть приложение"),
    BotCommand(command="status", description="Мои заявки"),
    BotCommand(command="tasks", description="Мои задачи (менеджер)"),
    BotCommand(command="notifications", description="Непрочитанные уведомления"),
    BotCommand(command="help", description="Помощь"),
    BotCommand(command="cancel", description="Отменить действие"),
]


def build_dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())
    dp.update.outer_middleware(DedupMiddleware())
    dp.update.outer_middleware(DbUserMiddleware())
    # Роутер модульный: при пересоздании Dispatcher (тесты, перезапуск) отцепляем его от прежнего
    router._parent_router = None  # noqa: SLF001
    dp.include_router(router)
    return dp


class BotRuntime:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # Если api.telegram.org недоступен напрямую — HTTP-прокси через TELEGRAM_PROXY
        session = AiohttpSession(proxy=settings.telegram_proxy) if settings.telegram_proxy else None
        self.bot = Bot(settings.bot_token, session=session, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        self.dp = build_dispatcher()
        self.running = False

    async def _setup(self) -> None:
        me = await self.bot.get_me()
        if not self.settings.telegram_bot_username:
            self.settings.telegram_bot_username = me.username
        await self.bot.set_my_commands(COMMANDS)
        url = miniapp_url()
        if url:
            await self.bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Приложение", web_app=WebAppInfo(url=url)))
        log.info("Бот @%s готов, Mini App: %s", me.username, url or "не настроен (нужен PUBLIC_BASE_URL с HTTPS)")

    async def register_webhook(self) -> str:
        if not self.settings.public_base_url or not self.settings.webhook_secret:
            raise RuntimeError("Для webhook нужен PUBLIC_BASE_URL с HTTPS")
        url = f"{self.settings.public_base_url.rstrip('/')}/api/telegram/webhook"
        await self.bot.set_webhook(url=url, secret_token=self.settings.webhook_secret, allowed_updates=self.dp.resolve_used_update_types())
        return url

    async def start(self) -> list[asyncio.Task]:
        tasks: list[asyncio.Task] = []
        if self.settings.on_vercel:
            # Команды, меню и webhook регистрируются при сборке (scripts/vercel_build.py), а не на каждом холодном старте;
            # уведомления отправляются в конце запросов, которые их создают (фоновых циклов на Vercel нет)
            try:
                if not self.settings.telegram_bot_username:
                    self.settings.telegram_bot_username = (await self.bot.get_me()).username
                self.running = True
            except Exception as e:  # noqa: BLE001
                log.error("Бот недоступен: %s", e)
            return tasks
        try:
            await self._setup()
            if self.settings.telegram_mode == "webhook":
                await self.register_webhook()
            else:
                await self.bot.delete_webhook(drop_pending_updates=False)
                tasks.append(asyncio.create_task(self.dp.start_polling(self.bot, handle_signals=False, close_bot_session=False,
                                                                       allowed_updates=self.dp.resolve_used_update_types())))
            self.running = True
        except Exception as e:  # noqa: BLE001
            log.error("Бот не запущен: %s. API и Mini App работают, уведомления будут отправлены после восстановления связи", e)
        if self.settings.notifier_enabled:
            tasks.append(asyncio.create_task(outbox_loop(self.bot, self.settings.notifier_interval_seconds)))
        return tasks

    async def feed_raw(self, body: bytes) -> None:
        update = Update.model_validate_json(body, context={"bot": self.bot})
        await self.dp.feed_update(self.bot, update)

    async def stop(self) -> None:
        try:
            if self.dp._running_lock.locked():  # noqa: SLF001
                await self.dp.stop_polling()
        except Exception:  # noqa: BLE001
            pass
        await self.bot.session.close()
