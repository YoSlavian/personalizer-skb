from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from app.api.types import Email
from sqlalchemy import select

from app.api.deps import DB, Admin, client_ip, paginated, reload
from app.api.serializers import audit_out, user_out
from app.demo_accounts import ensure_not_public_demo
from app.models import User
from app.models.enums import Position, UserRole
from app.services import users as user_svc

router = APIRouter(prefix="/admin", tags=["admin"])


class UserIn(BaseModel):
    email: Email
    full_name: Annotated[str, Field(min_length=2, max_length=200)]
    role: UserRole
    password: Annotated[str, Field(min_length=8, max_length=200)]
    org_id: int | None = None
    position: Position | None = None


class UserPatch(BaseModel):
    full_name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: Annotated[str, Field(min_length=8, max_length=200)] | None = None


@router.get("/users")
async def users(admin: Admin, db: DB, search: Annotated[str | None, Query(max_length=100)] = None, role: UserRole | None = None,
                page: Annotated[int, Query(ge=1)] = 1, size: Annotated[int, Query(ge=1, le=100)] = 25) -> dict:
    items, total = await user_svc.list_users(db, search=search, role=role, page=page, size=size)
    return paginated([user_out(u) for u in items], total, page, size)


@router.post("/users", status_code=201)
async def create_user(body: UserIn, request: Request, admin: Admin, db: DB) -> dict:
    ensure_not_public_demo(admin)
    u = await user_svc.create_user(db, admin, email=body.email, full_name=body.full_name, role=body.role, password=body.password,
                                   org_id=body.org_id, position=body.position, ip=client_ip(request))
    await db.commit()
    return user_out(await reload(db, User, u.id))


@router.patch("/users/{user_id}")
async def patch_user(user_id: int, body: UserPatch, request: Request, admin: Admin, db: DB) -> dict:
    ensure_not_public_demo(admin)
    await user_svc.update_user(db, admin, user_id, body.model_dump(exclude_unset=True), ip=client_ip(request))
    await db.commit()
    return user_out(await reload(db, User, user_id))


@router.get("/audit")
async def audit(admin: Admin, db: DB, action: Annotated[str | None, Query(max_length=64)] = None, actor_id: int | None = None,
                entity_type: Annotated[str | None, Query(max_length=32)] = None, org_id: int | None = None,
                page: Annotated[int, Query(ge=1)] = 1, size: Annotated[int, Query(ge=1, le=100)] = 50) -> dict:
    items, total = await user_svc.list_audit(db, action=action, actor_id=actor_id, entity_type=entity_type, org_id=org_id, page=page, size=size)
    actor_ids = {e.actor_id for e in items if e.actor_id}
    actors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars()} if actor_ids else {}
    return paginated([audit_out(e, actors.get(e.actor_id)) for e in items], total, page, size)
