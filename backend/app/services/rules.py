from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine.rules import DEFAULT_RULES, RulesConfig
from app.errors import NotFound, ValidationFailed
from app.models import RuleSet, User
from app.services.audit import audit

_cache: dict[int, RulesConfig] = {}


async def active_rules(session: AsyncSession) -> tuple[int, RulesConfig]:
    rs = (await session.execute(select(RuleSet).where(RuleSet.is_active.is_(True)).limit(1))).scalar_one_or_none()
    if rs is None:
        return 0, RulesConfig.model_validate(DEFAULT_RULES)
    cfg = _cache.get(rs.version)
    if cfg is None:
        cfg = _cache[rs.version] = RulesConfig.model_validate(rs.config)
    return rs.version, cfg


async def ensure_default(session: AsyncSession) -> RuleSet:
    rs = (await session.execute(select(RuleSet).order_by(RuleSet.version).limit(1))).scalar_one_or_none()
    if rs:
        return rs
    full = RulesConfig.model_validate(DEFAULT_RULES).model_dump()
    rs = RuleSet(version=1, config=full, comment="Стартовые коэффициенты из прототипа команды", is_active=True)
    session.add(rs)
    await session.flush()
    return rs


async def list_versions(session: AsyncSession) -> list[RuleSet]:
    return list((await session.execute(select(RuleSet).order_by(RuleSet.version.desc()))).scalars())


async def get_version(session: AsyncSession, version: int) -> RuleSet:
    rs = (await session.execute(select(RuleSet).where(RuleSet.version == version))).scalar_one_or_none()
    if rs is None:
        raise NotFound("Версия правил не найдена")
    return rs


def validate_config(config: dict[str, Any]) -> RulesConfig:
    try:
        return RulesConfig.model_validate(config)
    except ValidationError as e:
        raise ValidationFailed(
            "Конфигурация правил не прошла проверку",
            details=[{"loc": ".".join(str(x) for x in err["loc"]), "msg": err["msg"]} for err in e.errors()],
        ) from e


async def create_version(session: AsyncSession, actor: User, config: dict[str, Any], comment: str, activate: bool) -> RuleSet:
    cfg = validate_config(config)
    next_version = ((await session.execute(select(func.max(RuleSet.version)))).scalar() or 0) + 1
    rs = RuleSet(version=next_version, config=cfg.model_dump(), comment=comment.strip()[:300], is_active=False, created_by=actor.id)
    session.add(rs)
    await session.flush()
    audit(session, actor_id=actor.id, action="rules.create", entity_type="rule_set", entity_id=rs.id, details={"version": next_version})
    if activate:
        await activate_version(session, actor, next_version)
    return rs


async def activate_version(session: AsyncSession, actor: User, version: int) -> RuleSet:
    rs = await get_version(session, version)
    await session.execute(update(RuleSet).where(RuleSet.is_active.is_(True)).values(is_active=False))
    rs.is_active = True
    audit(session, actor_id=actor.id, action="rules.activate", entity_type="rule_set", entity_id=rs.id, details={"version": version})
    await session.flush()
    return rs
