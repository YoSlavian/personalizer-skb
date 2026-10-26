"""Демо-режим для показа экспертам. Работает только при DEMO_MODE=true; в production эндпоинты отвечают 404.

Смена демо-персоны в Mini App подтверждается подписанными initData: Telegram-аккаунт привязывается к выбранной
синтетической учётке, ID пользователя из клиентского JSON не используется.
"""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, client_ip
from app.api.routes.auth import _me_payload
from app.config import get_settings
from app.demo_accounts import DEMO_ACCOUNTS, DEMO_PASSWORD
from app.errors import NotFound
from app.models import User
from app.models.enums import SessionKind
from app.services import auth as auth_svc

router = APIRouter(prefix="/demo", tags=["demo"])


class PersonaIn(BaseModel):
    init_data: str = Field(min_length=1, max_length=4096)
    email: Literal["analyst@demo.local", "km.ivanova@demo.local", "fd@pole-invest.demo", "buh@kod-servis.demo", "admin@demo.local"]


def _persona_allowed(email: str) -> bool:
    return not (get_settings().is_production and email == "admin@demo.local")


def _ensure_demo() -> None:
    if not get_settings().demo_mode:
        raise NotFound("Не найдено")


@router.get("/accounts")
async def accounts() -> dict:
    _ensure_demo()
    accounts = DEMO_ACCOUNTS
    if get_settings().is_production:
        # На публичном сервере демо-администратора нет: администрирует личная учётка из ADMIN_EMAIL
        accounts = [a for a in DEMO_ACCOUNTS if a["role"] != "admin"]
    return {"password": DEMO_PASSWORD, "accounts": accounts}


@router.post("/telegram-persona")
async def telegram_persona(body: PersonaIn, request: Request, db: DB) -> dict:
    _ensure_demo()
    if not _persona_allowed(body.email):
        raise NotFound("Демо-учётка не найдена")
    tg = auth_svc.check_init_data(body.init_data)
    user = (await db.execute(select(User).where(User.email == body.email, User.is_active.is_(True)))).scalar_one_or_none()
    if user is None:
        raise NotFound("Демо-учётка не найдена. Запустите заполнение демо-данных")
    await auth_svc.link_telegram_account(db, user, telegram_user_id=tg.id, chat_id=tg.id, username=tg.username, via="demo")
    issued = await auth_svc._issue(db, user, SessionKind.miniapp, client_ip(request), request.headers.get("user-agent"))
    await db.commit()
    return {"token": issued.token, **await _me_payload(db, user)}
