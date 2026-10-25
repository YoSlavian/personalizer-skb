"""Аутентификация: email + пароль (веб), подписанные initData (Mini App), одноразовые коды привязки Telegram."""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import utcnow
from app.errors import Forbidden, NotFound, TooManyRequests, Unauthorized, ValidationFailed
from app.models import AuthSession, LinkCode, TelegramLink, User
from app.models.enums import SessionKind
from app.security.passwords import hash_password, needs_rehash, validate_password_strength, verify_password
from app.security.rate_limit import SlidingWindowLimiter
from app.security.telegram_auth import InitDataError, TelegramWebAppUser, validate_init_data
from app.security.tokens import new_token, token_hash
from app.services.audit import audit

_settings = get_settings()
login_limiter = SlidingWindowLimiter(_settings.login_attempts_per_window, _settings.login_window_seconds)
ip_login_limiter = SlidingWindowLimiter(_settings.login_attempts_per_window * 6, _settings.login_window_seconds)
LINK_CODE_TTL = timedelta(minutes=15)


@dataclass
class IssuedSession:
    token: str
    csrf_token: str
    session: AuthSession
    user: User


async def _issue(session: AsyncSession, user: User, kind: SessionKind, ip: str | None, user_agent: str | None) -> IssuedSession:
    s = get_settings()
    ttl = s.session_ttl_hours if kind == SessionKind.web else s.miniapp_session_ttl_hours
    token, csrf = new_token(), new_token(16)
    now = utcnow()
    row = AuthSession(user_id=user.id, token_hash=token_hash(token), csrf_token=csrf, kind=kind, created_at=now,
                      expires_at=now + timedelta(hours=ttl), ip=ip, user_agent=(user_agent or "")[:300] or None)
    session.add(row)
    user.last_login_at = now
    await session.flush()
    return IssuedSession(token=token, csrf_token=csrf, session=row, user=user)


async def login(session: AsyncSession, email: str, password: str, *, ip: str | None, user_agent: str | None) -> IssuedSession:
    email = email.strip().lower()
    # Лимит на учётку не зависит от IP: смена адреса не даёт бесконечных попыток подбора пароля
    key = email
    for limiter, k in ((login_limiter, key), (ip_login_limiter, ip or "-")):
        wait = limiter.blocked(k)
        if wait:
            raise TooManyRequests("Слишком много попыток входа. Попробуйте позже", retry_after=int(wait) + 1)
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not verify_password(password, user.password_hash if user else None) or not user or not user.is_active:
        login_limiter.hit(key)
        ip_login_limiter.hit(ip or "-")
        audit(session, actor_id=user.id if user else None, action="auth.login_failed", details={"email": email}, ip=ip)
        await session.commit()
        raise Unauthorized("Неверный email или пароль", code="invalid_credentials")
    login_limiter.reset(key)
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    issued = await _issue(session, user, SessionKind.web, ip, user_agent)
    audit(session, actor_id=user.id, action="auth.login", details={"kind": "web"}, ip=ip)
    return issued


async def resolve_session(session: AsyncSession, token: str | None) -> AuthSession | None:
    if not token or len(token) > 200:
        return None
    row = (await session.execute(select(AuthSession).where(AuthSession.token_hash == token_hash(token)))).scalar_one_or_none()
    if row is None or row.revoked_at is not None or row.expires_at <= utcnow() or not row.user.is_active:
        return None
    return row


async def logout(session: AsyncSession, auth: AuthSession) -> None:
    auth.revoked_at = utcnow()
    audit(session, actor_id=auth.user_id, action="auth.logout")


async def revoke_all(session: AsyncSession, user_id: int, except_id: int | None = None) -> None:
    q = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if except_id:
        q = q.where(AuthSession.id != except_id)
    await session.execute(q.values(revoked_at=utcnow()))


def check_init_data(init_data: str) -> TelegramWebAppUser:
    s = get_settings()
    if not s.bot_token:
        raise Forbidden("Telegram не настроен на сервере", code="telegram_not_configured")
    try:
        return validate_init_data(init_data, s.bot_token, max_age_seconds=s.telegram_init_data_ttl_seconds)
    except InitDataError as e:
        raise Unauthorized(f"Подпись Telegram не прошла проверку: {e}", code="invalid_init_data") from e


async def login_telegram(session: AsyncSession, init_data: str, *, ip: str | None, user_agent: str | None) -> IssuedSession:
    tg = check_init_data(init_data)
    link = (await session.execute(select(TelegramLink).where(TelegramLink.telegram_user_id == tg.id))).scalar_one_or_none()
    if link is None or not link.user.is_active:
        raise Forbidden("Telegram-аккаунт не привязан к пользователю", code="telegram_not_linked")
    issued = await _issue(session, link.user, SessionKind.miniapp, ip, user_agent)
    audit(session, actor_id=link.user_id, action="auth.login", details={"kind": "miniapp"}, ip=ip)
    return issued


async def link_telegram_account(session: AsyncSession, user: User, *, telegram_user_id: int, chat_id: int, username: str | None, via: str) -> TelegramLink:
    link = (await session.execute(select(TelegramLink).where(TelegramLink.telegram_user_id == telegram_user_id))).scalar_one_or_none()
    if link and link.user_id != user.id:
        prev = link.user_id
        link.user_id, link.chat_id, link.username, link.via, link.linked_at = user.id, chat_id, username, via, utcnow()
        audit(session, actor_id=user.id, action="telegram.relink", entity_type="user", entity_id=user.id, details={"previous_user": prev, "via": via})
    elif link is None:
        link = TelegramLink(user_id=user.id, telegram_user_id=telegram_user_id, chat_id=chat_id, username=username, via=via)
        session.add(link)
        audit(session, actor_id=user.id, action="telegram.link", entity_type="user", entity_id=user.id, details={"via": via})
    else:
        link.chat_id, link.username = chat_id, username
    await session.flush()
    return link


async def link_via_miniapp_login(session: AsyncSession, init_data: str, email: str, password: str, *, ip: str | None, user_agent: str | None) -> IssuedSession:
    """В Mini App непривязанный пользователь входит по email и паролю — аккаунт привязывается к подписанному Telegram ID."""
    tg = check_init_data(init_data)
    web = await login(session, email, password, ip=ip, user_agent=user_agent)
    web.session.revoked_at = utcnow()
    await link_telegram_account(session, web.user, telegram_user_id=tg.id, chat_id=tg.id, username=tg.username, via="miniapp")
    return await _issue(session, web.user, SessionKind.miniapp, ip, user_agent)


async def create_link_code(session: AsyncSession, user: User) -> tuple[str, LinkCode]:
    code = new_token(12)
    row = LinkCode(user_id=user.id, code_hash=token_hash(code), expires_at=utcnow() + LINK_CODE_TTL)
    session.add(row)
    await session.flush()
    audit(session, actor_id=user.id, action="telegram.link_code", entity_type="user", entity_id=user.id)
    return code, row


async def consume_link_code(session: AsyncSession, code: str, *, telegram_user_id: int, chat_id: int, username: str | None) -> User:
    if not code or len(code) > 64:
        raise ValidationFailed("Некорректный код привязки")
    row = (await session.execute(select(LinkCode).where(LinkCode.code_hash == token_hash(code)))).scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at <= utcnow():
        raise NotFound("Код привязки не найден или устарел. Получите новый в веб-кабинете", code="link_code_invalid")
    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        raise NotFound("Пользователь не найден")
    row.used_at = utcnow()
    await link_telegram_account(session, user, telegram_user_id=telegram_user_id, chat_id=chat_id, username=username, via="code")
    return user


async def change_password(session: AsyncSession, user: User, current: str, new: str, current_session_id: int | None) -> None:
    if not verify_password(current, user.password_hash):
        raise ValidationFailed("Текущий пароль указан неверно", details=[{"loc": "current_password", "msg": "Неверный пароль"}])
    problem = validate_password_strength(new)
    if problem:
        raise ValidationFailed(problem, details=[{"loc": "new_password", "msg": problem}])
    user.password_hash = hash_password(new)
    await revoke_all(session, user.id, except_id=current_session_id)
    audit(session, actor_id=user.id, action="auth.password_change", entity_type="user", entity_id=user.id)
