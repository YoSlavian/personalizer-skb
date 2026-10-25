"""Зависимости API: сессия БД, текущий пользователь, проверка CSRF и ролей.

Веб использует httpOnly-cookie сессии + double-submit CSRF-токен в заголовке X-CSRF-Token для изменяющих запросов.
Mini App использует Bearer-токен (не отправляется браузером автоматически, поэтому CSRF к нему неприменим).
"""

from collections.abc import AsyncIterator
from typing import Annotated, TypeVar

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import db as dbmod
from app.errors import Forbidden, NotFound, Unauthorized
from app.models import AuthSession, User
from app.models.enums import UserRole
from app.security.tokens import constant_eq
from app.services.auth import resolve_session

SESSION_COOKIE = "sp_session"
CSRF_COOKIE = "sp_csrf"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
T = TypeVar("T")


async def get_db() -> AsyncIterator[AsyncSession]:
    async with dbmod.session_factory()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


DB = Annotated[AsyncSession, Depends(get_db)]


def _bearer(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


async def get_auth(request: Request, db: DB) -> AuthSession:
    token = _bearer(request)
    via_cookie = False
    if not token:
        token = request.cookies.get(SESSION_COOKIE)
        via_cookie = token is not None
    auth = await resolve_session(db, token)
    if auth is None:
        raise Unauthorized("Требуется вход", code="unauthorized")
    if via_cookie and request.method not in SAFE_METHODS and not constant_eq(request.headers.get("x-csrf-token"), auth.csrf_token):
        raise Forbidden("Проверка CSRF не пройдена. Обновите страницу", code="csrf_failed")
    request.state.user_id = auth.user_id
    return auth


Auth = Annotated[AuthSession, Depends(get_auth)]


async def get_user(auth: Auth) -> User:
    return auth.user


CurrentUser = Annotated[User, Depends(get_user)]


def require(*roles: UserRole):  # noqa: ANN201
    async def dep(user: CurrentUser) -> User:
        if user.role not in roles:
            raise Forbidden("Недостаточно прав для этого раздела")
        return user

    return Depends(dep)


Staff = Annotated[User, require(UserRole.admin, UserRole.analyst, UserRole.manager)]
AnalystOrAdmin = Annotated[User, require(UserRole.admin, UserRole.analyst)]
Admin = Annotated[User, require(UserRole.admin)]
Client = Annotated[User, require(UserRole.client)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def reload(db: AsyncSession, model: type[T], obj_id: int) -> T:
    """Перечитывает объект с eager-связями (после создания связи ещё не загружены)."""
    obj = (await db.execute(select(model).where(model.id == obj_id).execution_options(populate_existing=True))).unique().scalar_one_or_none()  # type: ignore[attr-defined]
    if obj is None:
        raise NotFound("Объект не найден")
    return obj


def paginated(items: list, total: int, page: int, size: int) -> dict:
    return {"items": items, "total": total, "page": page, "size": size, "pages": (total + size - 1) // size if size else 0}
