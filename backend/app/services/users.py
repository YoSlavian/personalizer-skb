"""Пользователи: профиль, настройки уведомлений, администрирование в рамках полномочий."""

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import like_pattern
from app.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import AuditEvent, Contact, Organization, TelegramLink, User, UserSettings
from app.models.enums import Position, UserRole
from app.security.passwords import hash_password, validate_password_strength
from app.services.audit import audit
from app.services.auth import revoke_all

SETTINGS_FIELDS = {"notify_telegram", "notify_applications", "notify_tasks", "notify_offers", "adaptive_hints"}


async def ensure_settings(session: AsyncSession, user: User) -> UserSettings:
    if user.settings is None:
        user.settings = UserSettings(user_id=user.id)
        await session.flush()
    return user.settings


async def update_settings(session: AsyncSession, user: User, data: dict[str, Any]) -> UserSettings:
    s = await ensure_settings(session, user)
    changes = {}
    for k, v in data.items():
        if k not in SETTINGS_FIELDS:
            raise ValidationFailed(f"Неизвестная настройка: {k}")
        if v is not None and getattr(s, k) != bool(v):
            setattr(s, k, bool(v))
            changes[k] = bool(v)
    if changes:
        audit(session, actor_id=user.id, action="settings.update", entity_type="user", entity_id=user.id, details=changes)
    await session.flush()
    return s


async def unlink_telegram(session: AsyncSession, user: User, link_id: int) -> None:
    link = (await session.execute(select(TelegramLink).where(TelegramLink.id == link_id, TelegramLink.user_id == user.id))).scalar_one_or_none()
    if link is None:
        raise NotFound("Привязка не найдена")
    await session.delete(link)
    audit(session, actor_id=user.id, action="telegram.unlink", entity_type="user", entity_id=user.id)
    await session.flush()


async def memberships(session: AsyncSession, user: User) -> list[Contact]:
    return list((await session.execute(select(Contact).where(Contact.user_id == user.id))).scalars())


async def list_users(session: AsyncSession, *, search: str | None, role: UserRole | None, page: int, size: int) -> tuple[list[User], int]:
    q = select(User)
    if search:
        like = like_pattern(search)
        q = q.where(or_(User.email.ilike(like, escape="\\"), User.full_name.ilike(like, escape="\\")))
    if role:
        q = q.where(User.role == role)
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await session.execute(q.order_by(User.role, User.full_name).offset((page - 1) * size).limit(size))).scalars().all()
    return list(items), total


async def managers(session: AsyncSession) -> list[User]:
    return list((await session.execute(select(User).where(User.role == UserRole.manager, User.is_active.is_(True)).order_by(User.full_name))).scalars())


async def ensure_bootstrap_admin(session: AsyncSession) -> str | None:
    """Личный администратор из ADMIN_EMAIL / ADMIN_PASSWORD. Пароль хранится только у хостинга; смена переменной меняет пароль."""
    from app.config import get_settings
    from app.models import UserSettings
    from app.security.passwords import verify_password

    s = get_settings()
    if not s.admin_email or not s.admin_password:
        return None
    email, password = s.admin_email.strip().lower(), s.admin_password.get_secret_value()
    if len(password) < 12 or validate_password_strength(password):
        return "ADMIN_PASSWORD слишком простой: нужно не меньше 12 символов, буквы и цифры"
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, full_name=s.admin_name, role=UserRole.admin, password_hash=hash_password(password))
        user.settings = UserSettings()
        session.add(user)
        await session.flush()
        audit(session, actor_id=user.id, action="admin.bootstrap", entity_type="user", entity_id=user.id)
    else:
        user.role, user.is_active = UserRole.admin, True
        if not verify_password(password, user.password_hash):
            user.password_hash = hash_password(password)
            audit(session, actor_id=user.id, action="admin.password_rotated", entity_type="user", entity_id=user.id)
    await session.commit()
    return None


async def create_user(session: AsyncSession, actor: User, *, email: str, full_name: str, role: UserRole, password: str,
                      org_id: int | None, position: Position | None, ip: str | None = None) -> User:
    email = email.strip().lower()
    if (await session.execute(select(User.id).where(User.email == email))).scalar_one_or_none():
        raise Conflict("Пользователь с таким email уже есть", code="email_taken")
    problem = validate_password_strength(password)
    if problem:
        raise ValidationFailed(problem, details=[{"loc": "password", "msg": problem}])
    if role == UserRole.client and org_id is None:
        raise ValidationFailed("Для клиента укажите организацию", details=[{"loc": "org_id", "msg": "Обязательное поле"}])
    user = User(email=email, full_name=full_name.strip()[:200], role=role, password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    session.add(UserSettings(user_id=user.id))
    if org_id is not None:
        org = await session.get(Organization, org_id)
        if org is None:
            raise ValidationFailed("Организация не найдена", details=[{"loc": "org_id", "msg": "Нет такой организации"}])
        session.add(Contact(org_id=org.id, label=f"Пользователь кабинета #{user.id}", crm_position=position, user_id=user.id))
    audit(session, actor_id=actor.id, action="user.create", entity_type="user", entity_id=user.id, details={"role": role.value, "org_id": org_id}, ip=ip)
    await session.flush()
    return user


async def update_user(session: AsyncSession, actor: User, user_id: int, data: dict[str, Any], *, ip: str | None = None) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("Пользователь не найден")
    changes: dict[str, Any] = {}
    if "role" in data and data["role"] is not None and UserRole(data["role"]) != user.role:
        if user.id == actor.id:
            raise Forbidden("Нельзя изменить собственную роль")
        changes["role"] = {"from": user.role.value, "to": data["role"]}
        user.role = UserRole(data["role"])
    if "is_active" in data and data["is_active"] is not None and bool(data["is_active"]) != user.is_active:
        if user.id == actor.id:
            raise Forbidden("Нельзя заблокировать самого себя")
        user.is_active = bool(data["is_active"])
        changes["is_active"] = user.is_active
        if not user.is_active:
            await revoke_all(session, user.id)
    if data.get("full_name"):
        user.full_name = data["full_name"].strip()[:200]
        changes["full_name"] = True
    if data.get("password"):
        problem = validate_password_strength(data["password"])
        if problem:
            raise ValidationFailed(problem, details=[{"loc": "password", "msg": problem}])
        user.password_hash = hash_password(data["password"])
        await revoke_all(session, user.id)
        changes["password"] = "reset"
    if changes:
        audit(session, actor_id=actor.id, action="user.update", entity_type="user", entity_id=user.id, details=changes, ip=ip)
    await session.flush()
    return user


async def list_audit(session: AsyncSession, *, action: str | None, actor_id: int | None, entity_type: str | None, org_id: int | None,
                     page: int, size: int) -> tuple[list[AuditEvent], int]:
    q = select(AuditEvent)
    if action:
        q = q.where(AuditEvent.action.ilike(f"{action.strip()[:64]}%"))
    if actor_id:
        q = q.where(AuditEvent.actor_id == actor_id)
    if entity_type:
        q = q.where(AuditEvent.entity_type == entity_type)
    if org_id:
        q = q.where(AuditEvent.org_id == org_id)
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await session.execute(q.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).offset((page - 1) * size).limit(size))).scalars().all()
    return list(items), total
