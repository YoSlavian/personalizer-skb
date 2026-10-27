from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import DB, AnalystOrAdmin, CurrentUser, Staff, client_ip, paginated
from app.api.serializers import comm_out, contact_out, decision_out, org_out, user_brief
from app.demo_accounts import DEMO_CLIENT_CARD_MESSAGE, DEMO_CONSENTS_MESSAGE, ensure_not_public_demo
from app.engine.catalog import industry_name
from app.errors import ValidationFailed
from app.models.enums import AbVariant, ConsentChannel, IbRights, Industry, Position, SignalKind
from app.services import decisions as dec_svc
from app.services import orgs as org_svc
from app.services.access import get_org
from app.services.communications import list_communications
from app.services.profiles import group_members
from app.services.rules import active_rules
from app.services.users import managers

router = APIRouter(tags=["organizations"])


class OrgPatch(BaseModel):
    industry: Industry | None = None
    okved: Annotated[str, Field(max_length=16)] | None = None
    revenue_mln: Annotated[int, Field(ge=0, le=10_000_000)] | None = None
    seasonal: bool | None = None
    logins_30d: Annotated[int, Field(ge=0, le=1000)] | None = None
    balance_kind: Literal["credit", "surplus"] | None = None
    manager_id: int | None = None
    ab_variant: AbVariant | None = None
    turnover_by_month: Annotated[list[Annotated[float, Field(ge=0, le=1e7)]], Field(min_length=12, max_length=12)] | None = None


class ContactPatch(BaseModel):
    crm_position: Position | None = None
    ib_rights: IbRights | None = None
    boss_access: bool | None = None
    is_primary: bool | None = None


class SignalIn(BaseModel):
    kind: SignalKind
    days: Annotated[int, Field(ge=1, le=90)] = 7
    note: Annotated[str, Field(max_length=200)] | None = None


class ConsentsIn(BaseModel):
    email: bool | None = None
    push: bool | None = None
    all: bool | None = None


class PreviewIn(BaseModel):
    """Частичный профиль: перекрывает признаки, собранные из данных (what-if, не сохраняется)."""

    overrides: dict[str, Any] = {}
    contact_id: int | None = None


class SimulateIn(BaseModel):
    profile: dict[str, Any]


@router.get("/orgs")
async def list_orgs(
    user: Staff,
    db: DB,
    search: Annotated[str | None, Query(max_length=100)] = None,
    industry: Industry | None = None,
    segment: Literal["S1", "S2", "S3", "S4"] | None = None,
    variant: AbVariant | None = None,
    group_id: int | None = None,
    sort: Literal["name", "-revenue", "-activity", "-updated"] = "name",
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    _, cfg = await active_rules(db)
    items, total = await org_svc.list_orgs(db, user, cfg, search=search, industry=industry, segment=segment, variant=variant,
                                           group_id=group_id, page=page, size=size, sort=sort)
    counts = await org_svc.open_task_counts(db, [o.id for o in items])
    return paginated([org_out(o, cfg, open_tasks=counts.get(o.id, 0)) for o in items], total, page, size)


@router.get("/orgs/{org_id}")
async def get_org_detail(org_id: int, user: Staff, db: DB) -> dict:
    _, cfg = await active_rules(db)
    org = await get_org(db, user, org_id)
    members = await group_members(db, org.group_id) if org.group_id else []
    counts = await org_svc.open_task_counts(db, [org.id])
    return {
        **org_out(org, cfg, open_tasks=counts.get(org.id, 0)),
        "contacts": [contact_out(c) for c in org.contacts],
        "group_members": [{"id": m.id, "name": m.name, "industry": m.industry.value, "industry_name": industry_name(m.industry.value),
                           "head": m.head_of_group, "balance_kind": m.balance_kind.value if m.balance_kind else None} for m in members],
    }


@router.patch("/orgs/{org_id}")
async def patch_org(org_id: int, body: OrgPatch, request: Request, user: AnalystOrAdmin, db: DB) -> dict:
    ensure_not_public_demo(user, DEMO_CLIENT_CARD_MESSAGE)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise ValidationFailed("Нет изменений")
    await org_svc.update_org(db, user, org_id, data, ip=client_ip(request))
    await db.commit()
    return await get_org_detail(org_id, user, db)


@router.patch("/orgs/{org_id}/contacts/{contact_id}")
async def patch_contact(org_id: int, contact_id: int, body: ContactPatch, request: Request, user: Staff, db: DB) -> dict:
    ensure_not_public_demo(user, DEMO_CLIENT_CARD_MESSAGE)
    await org_svc.update_contact(db, user, org_id, contact_id, body.model_dump(exclude_unset=True), ip=client_ip(request))
    await db.commit()
    return await get_org_detail(org_id, user, db)


@router.post("/orgs/{org_id}/signals")
async def post_signal(org_id: int, body: SignalIn, request: Request, user: Staff, db: DB) -> dict:
    ensure_not_public_demo(user, DEMO_CLIENT_CARD_MESSAGE)
    await org_svc.add_signal(db, user, org_id, body.kind, body.days, body.note, ip=client_ip(request))
    await db.commit()
    return await get_org_detail(org_id, user, db)


@router.delete("/orgs/{org_id}/signals/{signal_id}")
async def delete_signal(org_id: int, signal_id: int, request: Request, user: Staff, db: DB) -> dict:
    ensure_not_public_demo(user, DEMO_CLIENT_CARD_MESSAGE)
    await org_svc.remove_signal(db, user, org_id, signal_id, ip=client_ip(request))
    await db.commit()
    return await get_org_detail(org_id, user, db)


@router.put("/orgs/{org_id}/consents")
async def put_consents(org_id: int, body: ConsentsIn, request: Request, user: Staff, db: DB) -> dict:
    ensure_not_public_demo(user, DEMO_CONSENTS_MESSAGE)
    values = {ConsentChannel(k): v for k, v in body.model_dump(exclude_none=True).items()}
    await org_svc.set_consents(db, user, org_id, values, ip=client_ip(request))
    await db.commit()
    return await get_org_detail(org_id, user, db)


@router.get("/orgs/{org_id}/decision")
async def current_decision(org_id: int, user: Staff, db: DB) -> dict:
    org = await get_org(db, user, org_id)
    bundle = await dec_svc.decide_for_org(db, org)
    return dec_svc.bundle_payload(bundle, org)


@router.post("/orgs/{org_id}/decision/preview")
async def preview_decision(org_id: int, body: PreviewIn, user: Staff, db: DB) -> dict:
    org = await get_org(db, user, org_id)
    contact = next((c for c in org.contacts if c.id == body.contact_id), None) if body.contact_id else None
    bundle = await dec_svc.decide_for_org(db, org, contact=contact, overrides=body.overrides)
    return dec_svc.bundle_payload(bundle, org)


@router.post("/orgs/{org_id}/decisions")
async def save_decision(org_id: int, user: Staff, db: DB) -> dict:
    org = await get_org(db, user, org_id)
    bundle = await dec_svc.decide_for_org(db, org)
    d = await dec_svc.save_decision(db, user, bundle, trigger="manual")
    await db.commit()
    return decision_out(d)


@router.get("/orgs/{org_id}/decisions")
async def decision_history(org_id: int, user: Staff, db: DB) -> dict:
    return {"items": [decision_out(d) for d in await dec_svc.list_decisions(db, user, org_id)]}


@router.get("/orgs/{org_id}/communications")
async def org_communications(org_id: int, user: Staff, db: DB, page: Annotated[int, Query(ge=1)] = 1,
                             size: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    org = await get_org(db, user, org_id)
    items, total = await list_communications(db, user, org_id=org.id, channel=None, status=None, variant=None, product=None, run_id=None,
                                             search=None, page=page, size=size)
    return paginated([comm_out(c) for c in items], total, page, size)


@router.post("/decisions/simulate")
async def simulate(body: SimulateIn, user: Staff, db: DB) -> dict:
    """Симулятор без привязки к организации: любой синтетический профиль → решение."""
    version, profile, result = await dec_svc.simulate(db, body.profile)
    return {"rule_version": version, "profile": profile.model_dump(), "result": result.model_dump()}


@router.get("/groups/{group_id}/plan")
async def get_group_plan(group_id: int, user: Staff, db: DB) -> dict:
    group, members, plan, bundle = await dec_svc.group_plan(db, user, group_id)
    return {"group": {"id": group.id, "name": group.name, "ab_variant": group.ab_variant.value},
            "members": [{"id": m.id, "name": m.name, "head": m.head_of_group} for m in members],
            "plan": plan.model_dump(), "decision": bundle.result.model_dump(), "profile": bundle.profile.model_dump()}


@router.post("/groups/plan/simulate")
async def simulate_group_plan(body: SimulateIn, user: Staff, db: DB) -> dict:
    from app.engine import plan_group

    _, profile, result = await dec_svc.simulate(db, body.profile)
    if not profile.group:
        raise ValidationFailed("В профиле нет состава группы")
    _, cfg = await active_rules(db)
    return {"plan": plan_group(profile, cfg).model_dump(), "decision": result.model_dump()}


@router.get("/managers")
async def list_managers(user: CurrentUser, db: DB) -> dict:
    return {"items": [user_brief(m) for m in await managers(db)]} if user.is_staff else {"items": []}
