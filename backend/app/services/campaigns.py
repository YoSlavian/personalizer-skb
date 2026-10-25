"""Прогон оптимизатора по клиентам: решение → политика коммуникаций → доставка → задачи КМ.

A/B: вариант назначен на группу компаний (или самостоятельную компанию).
- test: новые признаки и правила, группа = один клиент;
- control: AS IS — тот же скор без новых признаков, общий текст, баннер каждому юрлицу отдельно.
Отказ от коммуникаций соблюдается в обоих вариантах (требование закона и правил коммуникаций).
"""

from collections import Counter
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.engine.catalog import PRODUCTS
from app.engine.policy import as_is_block, frequency_block, window_start
from app.engine.profile import Offer
from app.errors import NotFound, ValidationFailed
from app.models import CampaignRun, Communication, Organization, User
from app.models.enums import AbVariant, Channel, CommStatus, Priority, TaskKind, UserRole
from app.services.access import require_roles
from app.services.audit import audit
from app.services.decisions import decide_for_org, save_decision
from app.services.delivery import deliver, make_comm
from app.services.profiles import group_members, history_for
from app.services.rules import active_rules
from app.services.tasks import create_task


def _reason_key(reason: str) -> str:
    return reason.split(":")[0].split(" (")[0]


async def _units(session: AsyncSession, org_ids: list[int] | None) -> list[tuple[Organization, list[Organization]]]:
    q = select(Organization).order_by(Organization.id)
    if org_ids:
        q = q.where(Organization.id.in_(org_ids))
    orgs = list((await session.execute(q)).scalars())
    if org_ids and len(orgs) != len(set(org_ids)):
        raise NotFound("Часть организаций не найдена")
    units, seen = [], set()
    for org in orgs:
        if org.group_id:
            if org.group_id in seen:
                continue
            seen.add(org.group_id)
            members = await group_members(session, org.group_id)
            head = next((o for o in members if o.head_of_group), members[0])
            units.append((head, members))
        else:
            units.append((org, [org]))
    return units


def _task_dedupe(kind: str, org: Organization, product: str | None, now: datetime) -> str:
    year, week, _ = now.isocalendar()
    if kind == "update_crm_role":
        return f"update_crm_role:{org.id}:{year}-{week // 4}"
    if kind == "call_48h":
        return f"call_48h:{org.id}:{year}-{week}"
    return f"{kind}:{org.group_id or org.id}:{product}:{year}-{week}"


async def run_campaign(session: AsyncSession, actor: User, *, org_ids: list[int] | None, dry_run: bool) -> dict:
    require_roles(actor, UserRole.admin, UserRole.analyst)
    if org_ids is not None and len(org_ids) > 500:
        raise ValidationFailed("Не больше 500 организаций за один прогон")
    version, cfg = await active_rules(session)
    now = utcnow()
    units = await _units(session, org_ids)

    run = None
    if not dry_run:
        run = CampaignRun(started_by=actor.id, started_at=now, dry_run=False, rule_version=version, scope={"org_ids": org_ids or "all"}, stats={})
        session.add(run)
        await session.flush()

    channels: Counter[str] = Counter()
    blocked: Counter[str] = Counter()
    variants: Counter[str] = Counter()
    tasks_created = 0
    suppressed = 0
    no_offer = 0
    decisions = 0
    examples: list[dict] = []

    for head, members in units:
        bundle = await decide_for_org(session, head)
        r = bundle.result
        variant = bundle.variant
        variants[variant.value] += 1
        decision_id = None
        if not dry_run:
            decision_id = (await save_decision(session, None, bundle, trigger="campaign")).id
        decisions += 1
        if r.suppressed:
            suppressed += 1
            continue

        if variant == AbVariant.control:
            ac = r.as_is
            offer = Offer(product_code=ac.product_code, product_name=ac.product_name, headline=ac.headline,
                          body="Финансирование для вашего бизнеса. Рассчитайте условия онлайн.", cta="Рассчитать условия",
                          visual=PRODUCTS[ac.product_code].visual)
            for org in members:
                hist = await history_for(session, [org.id], window_start(now, cfg))
                reason = as_is_block(channel="banner_ib", product_code=offer.product_code, org_history=hist, now=now, cfg=cfg)
                if reason:
                    blocked[_reason_key(reason)] += 1
                channels["banner_ib"] += 0 if reason else 1
                if dry_run:
                    continue
                comm = make_comm(org=org, variant=variant, offer=offer, channel=Channel.banner_ib, recipient=ac.who,
                                 decision_id=decision_id, run_id=run.id, now=now)
                if reason:
                    comm.status, comm.blocked_reason = CommStatus.blocked, reason
                session.add(comm)
            continue

        if not r.offer:
            no_offer += 1
            continue
        is_group = len(members) > 1
        for ch in r.channels:
            reason = frequency_block(
                channel=ch.code,
                product_code=r.offer.product_code,
                activity_level=r.activity_level,
                event_driven=bool(r.event_note),
                org_history=bundle.built.history,
                group_history=bundle.built.history if is_group else None,
                now=now,
                cfg=cfg,
            )
            if reason:
                blocked[_reason_key(reason)] += 1
            else:
                channels[ch.code] += 1
            if dry_run:
                continue
            comm = make_comm(org=head, variant=variant, offer=r.offer, channel=Channel(ch.code), recipient=r.recipient,
                             decision_id=decision_id, run_id=run.id, now=now)
            session.add(comm)
            await session.flush()
            if reason:
                comm.status, comm.blocked_reason = CommStatus.blocked, reason
            else:
                await deliver(session, comm, head, result=r, actor_id=actor.id, now=now)

        for a in r.actions:
            if a.type != "km_task" or dry_run:
                continue
            _, created = await create_task(
                session,
                org=head,
                kind=TaskKind(a.kind),
                title=a.title or "Задача по решению оптимизатора",
                description=f"Решение оптимизатора: {r.nba}",
                priority=Priority(a.priority),
                due_hours=a.due_hours,
                source="rule",
                actor_id=actor.id,
                dedupe_key=_task_dedupe(a.kind or "", head, r.offer.product_code, now),
                now=now,
            )
            tasks_created += int(created)
        if len(examples) < 6:
            examples.append({"org_id": head.id, "company": r.company, "product": r.offer.product_name, "recipient": r.recipient,
                             "channels": [c.label for c in r.channels], "variant": variant.value})

    stats = {
        "units": len(units),
        "decisions": decisions,
        "variants": dict(variants),
        "sent_by_channel": dict(channels),
        "sent_total": sum(channels.values()),
        "blocked_by_reason": dict(blocked),
        "blocked_total": sum(blocked.values()),
        "suppressed_opt_out": suppressed,
        "no_offer": no_offer,
        "tasks_created": tasks_created,
        "examples": examples,
        "dry_run": dry_run,
        "rule_version": version,
    }
    if run is not None:
        run.stats = stats
        run.finished_at = utcnow()
        audit(session, actor_id=actor.id, action="campaign.run", entity_type="campaign_run", entity_id=run.id,
              details={"units": len(units), "sent": stats["sent_total"], "blocked": stats["blocked_total"]})
        await session.flush()
        stats["id"] = run.id
    return stats


async def list_runs(session: AsyncSession, page: int, size: int) -> tuple[list[CampaignRun], int]:
    total = (await session.execute(select(func.count()).select_from(CampaignRun))).scalar_one()
    q = select(CampaignRun).order_by(CampaignRun.started_at.desc(), CampaignRun.id.desc()).offset((page - 1) * size).limit(size)
    return list((await session.execute(q)).scalars()), total


async def get_run(session: AsyncSession, run_id: int) -> CampaignRun:
    run = await session.get(CampaignRun, run_id)
    if run is None:
        raise NotFound("Прогон не найден")
    return run


async def run_communications_count(session: AsyncSession, run_id: int) -> int:
    return (await session.execute(select(func.count()).where(Communication.campaign_run_id == run_id))).scalar_one()
