"""Разграничение доступа к данным. Проверка всегда на сервере: подмена ID в URL не даёт чужих данных.

- admin, analyst — все организации;
- manager — организации своего портфеля (organizations.manager_id);
- client — организации, где пользователь является контактом (членство).
Недоступный объект возвращает 404, чтобы не раскрывать факт его существования.
"""

from sqlalchemy import ColumnElement, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import Forbidden, NotFound
from app.models import Contact, Organization, User
from app.models.enums import UserRole


def require_roles(user: User, *roles: UserRole) -> None:
    if user.role not in roles:
        raise Forbidden("Недостаточно прав для этого действия")


def org_scope(user: User, org_id_col) -> ColumnElement[bool]:  # noqa: ANN001
    if user.role in (UserRole.admin, UserRole.analyst):
        return true()
    if user.role == UserRole.manager:
        return org_id_col.in_(select(Organization.id).where(Organization.manager_id == user.id))
    return org_id_col.in_(select(Contact.org_id).where(Contact.user_id == user.id))


async def get_org(session: AsyncSession, user: User, org_id: int) -> Organization:
    q = select(Organization).where(Organization.id == org_id, org_scope(user, Organization.id)).execution_options(populate_existing=True)
    org = (await session.execute(q)).unique().scalar_one_or_none()
    if org is None:
        raise NotFound("Организация не найдена")
    return org


async def client_org_ids(session: AsyncSession, user: User) -> list[int]:
    return list((await session.execute(select(Contact.org_id).where(Contact.user_id == user.id).order_by(Contact.org_id))).scalars())


async def client_contact(session: AsyncSession, user: User, org_id: int | None = None) -> Contact:
    """Контакт клиента (членство). Если организаций несколько — первая или указанная."""
    q = select(Contact).where(Contact.user_id == user.id)
    if org_id is not None:
        q = q.where(Contact.org_id == org_id)
    contact = (await session.execute(q.order_by(Contact.org_id).limit(1))).scalar_one_or_none()
    if contact is None:
        raise NotFound("Пользователь не привязан к организации")
    return contact
