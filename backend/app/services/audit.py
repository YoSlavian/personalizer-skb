from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent

_SECRET_KEYS = {"password", "token", "code", "init_data", "hash", "secret"}


def _scrub(details: dict[str, Any] | None) -> dict[str, Any]:
    if not details:
        return {}
    return {k: ("***" if any(s in k.lower() for s in _SECRET_KEYS) else v) for k, v in details.items()}


def audit(
    session: AsyncSession,
    *,
    actor_id: int | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    org_id: int | None = None,
    details: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    """Добавляет запись в журнал в рамках текущей транзакции."""
    session.add(
        AuditEvent(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            org_id=org_id,
            details=_scrub(details),
            ip=ip,
        )
    )
