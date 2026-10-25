"""Вебхук Telegram: принимает update только с верным секретом X-Telegram-Bot-Api-Secret-Token."""

from fastapi import APIRouter, Request

from app.config import get_settings
from app.errors import Forbidden, NotFound
from app.security.tokens import constant_eq

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.post("/webhook", include_in_schema=False)
async def webhook(request: Request) -> dict:
    s = get_settings()
    runtime = getattr(request.app.state, "bot_runtime", None)
    if runtime is None or s.telegram_mode != "webhook":
        raise NotFound("Вебхук не включён")
    secret = s.webhook_secret
    if not secret or not constant_eq(request.headers.get("x-telegram-bot-api-secret-token"), secret):
        raise Forbidden("Неверный секрет вебхука")
    body = await request.body()
    if len(body) > 1_000_000:
        raise Forbidden("Слишком большой update")
    await runtime.feed_raw(body)
    return {"ok": True}
