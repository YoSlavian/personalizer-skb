"""Кампании, журнал коммуникаций, правила, аналитика и главная панель."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import DB, AnalystOrAdmin, Staff, paginated
from app.api.serializers import app_out, comm_out, notification_out, rule_set_out, run_out, task_out
from app.engine.rules import DEFAULT_RULES, RulesConfig
from app.models.enums import AbVariant, Channel, CommStatus
from app.services import analytics as an_svc
from app.services import campaigns as camp_svc
from app.services import rules as rules_svc
from app.services.communications import list_communications
from app.services.dashboard import staff_dashboard

router = APIRouter(tags=["marketing"])


class RunIn(BaseModel):
    org_ids: Annotated[list[int], Field(max_length=500)] | None = None
    dry_run: bool = False


class RulesIn(BaseModel):
    config: dict[str, Any]
    comment: Annotated[str, Field(min_length=3, max_length=300)]
    activate: bool = True


@router.post("/campaigns/run")
async def run_campaign(body: RunIn, user: AnalystOrAdmin, db: DB) -> dict:
    stats = await camp_svc.run_campaign(db, user, org_ids=body.org_ids, dry_run=body.dry_run)
    await db.commit()
    return stats


@router.get("/campaigns")
async def list_runs(user: AnalystOrAdmin, db: DB, page: Annotated[int, Query(ge=1)] = 1, size: Annotated[int, Query(ge=1, le=50)] = 10) -> dict:
    items, total = await camp_svc.list_runs(db, page, size)
    return paginated([run_out(r) for r in items], total, page, size)


@router.get("/campaigns/{run_id}")
async def get_run(run_id: int, user: AnalystOrAdmin, db: DB) -> dict:
    run = await camp_svc.get_run(db, run_id)
    return {**run_out(run), "communications": await camp_svc.run_communications_count(db, run_id)}


@router.get("/communications")
async def communications(
    user: Staff, db: DB,
    org_id: int | None = None,
    channel: Channel | None = None,
    status: CommStatus | None = None,
    variant: AbVariant | None = None,
    product: Annotated[str | None, Query(max_length=32)] = None,
    run_id: int | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> dict:
    items, total = await list_communications(db, user, org_id=org_id, channel=channel, status=status, variant=variant, product=product,
                                             run_id=run_id, search=search, page=page, size=size)
    return paginated([comm_out(c) for c in items], total, page, size)


@router.get("/rules")
async def rules(user: Staff, db: DB) -> dict:
    versions = await rules_svc.list_versions(db)
    active = next((v for v in versions if v.is_active), None)
    return {"active": rule_set_out(active, with_config=True) if active else None, "versions": [rule_set_out(v) for v in versions],
            "default": RulesConfig.model_validate(DEFAULT_RULES).model_dump(), "schema": RulesConfig.model_json_schema()}


@router.get("/rules/{version}")
async def rule_version(version: int, user: Staff, db: DB) -> dict:
    return rule_set_out(await rules_svc.get_version(db, version), with_config=True)


@router.post("/rules", status_code=201)
async def create_rules(body: RulesIn, user: AnalystOrAdmin, db: DB) -> dict:
    rs = await rules_svc.create_version(db, user, body.config, body.comment, body.activate)
    await db.commit()
    return rule_set_out(await rules_svc.get_version(db, rs.version), with_config=True)


@router.post("/rules/{version}/activate")
async def activate_rules(version: int, user: AnalystOrAdmin, db: DB) -> dict:
    await rules_svc.activate_version(db, user, version)
    await db.commit()
    return rule_set_out(await rules_svc.get_version(db, version), with_config=True)


@router.get("/analytics/overview")
async def analytics(user: Staff, db: DB, days: Annotated[int, Query(ge=7, le=365)] = 90) -> dict:
    return await an_svc.overview(db, user, days)


@router.get("/dashboard")
async def dashboard(user: Staff, db: DB) -> dict:
    d = await staff_dashboard(db, user)
    return {**d, "tasks": [task_out(t) for t in d["tasks"]], "applications": [app_out(a) for a in d["applications"]],
            "runs": [run_out(r) for r in d["runs"]], "notifications": [notification_out(n) for n in d["notifications"]]}
