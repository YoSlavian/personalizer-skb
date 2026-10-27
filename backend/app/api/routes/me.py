from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import DB, Admin, Auth, CurrentUser, paginated, reload
from app.api.serializers import notification_out, user_out
from app.config import get_settings
from app.demo_accounts import DEMO_HINTS_MESSAGE, ensure_not_public_demo
from app.engine.catalog import catalog_payload
from app.models import User
from app.services import notifications as notif_svc
from app.services.auth import change_password, create_link_code
from app.services.users import unlink_telegram, update_settings

router = APIRouter(tags=["me"])


class ProfileIn(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=200)]


class SettingsIn(BaseModel):
    notify_telegram: bool | None = None
    notify_applications: bool | None = None
    notify_tasks: bool | None = None
    notify_offers: bool | None = None
    adaptive_hints: bool | None = None


class PasswordIn(BaseModel):
    current_password: Annotated[str, Field(min_length=1, max_length=200)]
    new_password: Annotated[str, Field(min_length=8, max_length=200)]


@router.get("/catalog")
async def catalog() -> dict:
    return catalog_payload()


@router.patch("/me")
async def update_me(body: ProfileIn, user: CurrentUser, db: DB) -> dict:
    ensure_not_public_demo(user)
    user.full_name = body.full_name.strip()
    await db.commit()
    return user_out(await reload(db, User, user.id))


@router.patch("/me/settings")
async def patch_settings(body: SettingsIn, user: CurrentUser, db: DB) -> dict:
    if body.adaptive_hints is not None:
        # Подсказки пути выключили бы адаптивный путь у всех зрителей общей демо-учётки
        ensure_not_public_demo(user, DEMO_HINTS_MESSAGE)
    await update_settings(db, user, body.model_dump(exclude_none=True))
    await db.commit()
    return user_out(await reload(db, User, user.id))


@router.post("/me/password")
async def post_password(body: PasswordIn, auth: Auth, db: DB) -> dict:
    ensure_not_public_demo(auth.user)
    await change_password(db, auth.user, body.current_password, body.new_password, auth.id)
    await db.commit()
    return {"ok": True}


@router.post("/me/telegram/link-code")
async def telegram_link_code(user: CurrentUser, db: DB) -> dict:
    """Одноразовый код (15 минут). Ссылка открывает бота и привязывает аккаунт: t.me/<bot>?start=<code>."""
    code, row = await create_link_code(db, user)
    await db.commit()
    bot = get_settings().telegram_bot_username
    return {"code": code, "expires_at": row.expires_at.isoformat(), "deep_link": f"https://t.me/{bot}?start={code}" if bot else None,
            "bot_username": bot}


@router.delete("/me/telegram/{link_id}")
async def telegram_unlink(link_id: int, user: Admin, db: DB) -> dict:
    await unlink_telegram(db, user, link_id)
    await db.commit()
    return user_out(await reload(db, User, user.id))


@router.get("/notifications")
async def notifications(user: CurrentUser, db: DB, unread: bool = False, page: Annotated[int, Query(ge=1)] = 1,
                        size: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    items, total = await notif_svc.list_for(db, user, unread_only=unread, page=page, size=size)
    return paginated([notification_out(n) for n in items], total, page, size) | {"unread": await notif_svc.unread_count(db, user)}


@router.get("/notifications/unread-count")
async def unread_count(user: CurrentUser, db: DB) -> dict:
    return {"unread": await notif_svc.unread_count(db, user)}


@router.post("/notifications/{notification_id}/read")
async def read_one(notification_id: int, user: CurrentUser, db: DB) -> dict:
    n = await notif_svc.mark_read(db, user, notification_id)
    await db.commit()
    return notification_out(n)


@router.post("/notifications/read-all")
async def read_all(user: CurrentUser, db: DB) -> dict:
    count = await notif_svc.mark_all_read(db, user)
    await db.commit()
    return {"updated": count}
