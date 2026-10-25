from typing import Annotated

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.api.types import Email

from app.api.deps import CSRF_COOKIE, DB, SESSION_COOKIE, Auth, client_ip, reload
from app.api.serializers import user_out
from app.config import get_settings
from app.models import User
from app.services import auth as auth_svc
from app.services.users import memberships

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=200)]


class TelegramIn(BaseModel):
    init_data: Annotated[str, Field(min_length=1, max_length=4096)]


class TelegramLoginIn(TelegramIn):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=200)]


def _set_cookies(response: Response, token: str, csrf: str) -> None:
    s = get_settings()
    max_age = s.session_ttl_hours * 3600
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure, samesite="lax", domain=s.cookie_domain, path="/")
    response.set_cookie(CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=s.cookie_secure, samesite="lax", domain=s.cookie_domain, path="/")


async def _me_payload(db: DB, user: User, csrf: str | None = None) -> dict:
    user = await reload(db, User, user.id)
    contacts = await memberships(db, user)
    return {
        "user": user_out(user),
        "organizations": [{"id": c.org_id, "contact_id": c.id} for c in contacts],
        "csrf_token": csrf,
        "demo_mode": get_settings().demo_mode,
        "bot_username": get_settings().telegram_bot_username,
    }


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: DB) -> dict:
    issued = await auth_svc.login(db, body.email, body.password, ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    await db.commit()
    _set_cookies(response, issued.token, issued.csrf_token)
    return await _me_payload(db, issued.user, issued.csrf_token)


@router.post("/logout")
async def logout(auth: Auth, response: Response, db: DB) -> dict:
    await auth_svc.logout(db, auth)
    await db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(auth: Auth, db: DB) -> dict:
    return await _me_payload(db, auth.user, auth.csrf_token)


@router.post("/telegram")
async def telegram_login(body: TelegramIn, request: Request, db: DB) -> dict:
    """Вход в Mini App по подписанным initData. Возвращает Bearer-токен."""
    issued = await auth_svc.login_telegram(db, body.init_data, ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    await db.commit()
    return {"token": issued.token, **await _me_payload(db, issued.user)}


@router.post("/telegram/link-login")
async def telegram_link_login(body: TelegramLoginIn, request: Request, db: DB) -> dict:
    """Первый вход в Mini App: email + пароль привязывают подписанный Telegram-аккаунт к пользователю."""
    issued = await auth_svc.link_via_miniapp_login(db, body.init_data, body.email, body.password, ip=client_ip(request),
                                                   user_agent=request.headers.get("user-agent"))
    await db.commit()
    return {"token": issued.token, **await _me_payload(db, issued.user)}
