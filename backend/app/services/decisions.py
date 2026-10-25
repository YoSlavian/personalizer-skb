"""Решения оптимизатора для организаций: текущее, what-if, сохранение, план группы."""

from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engine import ClientProfile, DecisionResult, decide, plan_group
from app.engine.holding import GroupPlan
from app.engine.rules import RulesConfig
from app.errors import NotFound, ValidationFailed
from app.integrations.optimizer import apply_scores, get_adapter
from app.models import CompanyGroup, Contact, Decision, Organization, User
from app.models.enums import AbVariant
from app.services.access import get_org, org_scope
from app.services.audit import audit
from app.services.profiles import BuiltProfile, build_profile, group_members
from app.services.rules import active_rules


@dataclass
class DecisionBundle:
    built: BuiltProfile
    profile: ClientProfile
    result: DecisionResult
    variant: AbVariant
    rule_version: int
    cfg: RulesConfig


def parse_profile(data: dict[str, Any]) -> ClientProfile:
    try:
        return ClientProfile.model_validate(data)
    except ValidationError as e:
        raise ValidationFailed(
            "Профиль клиента заполнен некорректно",
            details=[{"loc": ".".join(str(x) for x in err["loc"]), "msg": err["msg"]} for err in e.errors()],
        ) from e


async def decide_for_org(
    session: AsyncSession, org: Organization, *, contact: Contact | None = None, overrides: dict[str, Any] | None = None
) -> DecisionBundle:
    version, cfg = await active_rules(session)
    built = await build_profile(session, org, cfg, contact=contact)
    cfg = apply_scores(cfg, await get_adapter().scores(f"org-{built.org.id}", cfg))
    profile = built.profile
    if overrides:
        profile = parse_profile({**profile.model_dump(), **overrides})
    return DecisionBundle(built, profile, decide(profile, cfg), built.org.effective_variant, version, cfg)


def bundle_payload(b: DecisionBundle, requested_org: Organization) -> dict[str, Any]:
    ri = b.built.role_inference
    return {
        "org_id": requested_org.id,
        "decision_org_id": b.built.org.id,
        "group_level": requested_org.id != b.built.org.id or b.profile.structure == "group",
        "variant": b.variant.value,
        "rule_version": b.rule_version,
        "peak_month": b.built.peak_month,
        "role_inference": {"role": ri.role, "source": ri.source, "explanation": ri.explanation},
        "profile": b.profile.model_dump(),
        "result": b.result.model_dump(),
    }


async def save_decision(session: AsyncSession, actor: User | None, b: DecisionBundle, *, trigger: str) -> Decision:
    d = Decision(
        org_id=b.built.org.id,
        rule_version=b.rule_version,
        variant=b.variant,
        product_code=b.result.offer.product_code if b.result.offer else None,
        trigger=trigger,
        profile=b.profile.model_dump(),
        result=b.result.model_dump(),
        created_by=actor.id if actor else None,
    )
    session.add(d)
    await session.flush()
    if actor:
        audit(session, actor_id=actor.id, action="decision.save", entity_type="decision", entity_id=d.id, org_id=d.org_id,
              details={"product": d.product_code, "trigger": trigger})
    return d


async def list_decisions(session: AsyncSession, user: User, org_id: int, limit: int = 20) -> list[Decision]:
    org = await get_org(session, user, org_id)
    ids = [org.id]
    if org.group_id:
        ids = [m.id for m in await group_members(session, org.group_id)]
    q = select(Decision).where(Decision.org_id.in_(ids)).order_by(Decision.created_at.desc(), Decision.id.desc()).limit(limit)
    return list((await session.execute(q)).scalars())


async def simulate(session: AsyncSession, profile_data: dict[str, Any]) -> tuple[int, ClientProfile, DecisionResult]:
    version, cfg = await active_rules(session)
    profile = parse_profile(profile_data)
    return version, profile, decide(profile, cfg)


async def group_plan(session: AsyncSession, user: User, group_id: int, overrides: dict[str, Any] | None = None) -> tuple[CompanyGroup, list[Organization], GroupPlan, DecisionBundle]:
    group = await session.get(CompanyGroup, group_id)
    if group is None:
        raise NotFound("Группа не найдена")
    members = await group_members(session, group_id)
    visible = (await session.execute(select(Organization.id).where(Organization.group_id == group_id, org_scope(user, Organization.id)))).scalars().all()
    if not visible:
        raise NotFound("Группа не найдена")
    head = next((o for o in members if o.head_of_group), members[0])
    bundle = await decide_for_org(session, head, overrides=overrides)
    return group, members, plan_group(bundle.profile, bundle.cfg), bundle
