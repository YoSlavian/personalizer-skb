"""Идемпотентность изменяющих запросов по заголовку Idempotency-Key (повторное нажатие, ретрай при плохой связи)."""

import re

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import Conflict, ValidationFailed
from app.models import IdempotencyKey, User

_KEY = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


async def begin(db: AsyncSession, request: Request, user: User, scope: str) -> IdempotencyKey | JSONResponse | None:
    """None — заголовка нет; JSONResponse — повтор, отдаём сохранённый ответ; иначе — запись, которую надо завершить."""
    key = request.headers.get("idempotency-key")
    if not key:
        return None
    if not _KEY.match(key):
        raise ValidationFailed("Некорректный Idempotency-Key")
    existing = (await db.execute(select(IdempotencyKey).where(IdempotencyKey.user_id == user.id, IdempotencyKey.scope == scope,
                                                              IdempotencyKey.key == key))).scalar_one_or_none()
    if existing:
        if existing.response is not None:
            return JSONResponse(existing.response, status_code=existing.status_code or 200, headers={"Idempotent-Replayed": "true"})
        raise Conflict("Такой запрос уже обрабатывается", code="request_in_progress")
    row = IdempotencyKey(user_id=user.id, scope=scope, key=key)
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise Conflict("Такой запрос уже обрабатывается", code="request_in_progress") from e
    return row


def finish(row: IdempotencyKey | None, response: dict, status_code: int) -> None:
    if row is not None:
        row.response, row.status_code = response, status_code
