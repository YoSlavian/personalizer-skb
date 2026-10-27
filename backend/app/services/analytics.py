"""Метрики пилота и A/B: CTR, CR в заявку, просмотр → сделка, Time to Action, отписки, сообщения на группу, UX-метрики пути.

Все показатели считаются из журнала коммуникаций, заявок и сессий пути в БД. На синтетических данных они демонстрируют
расчёт, а не эффект: реальный эффект проверяется только пилотом.
"""

import math
from collections import defaultdict
from datetime import timedelta
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import utcnow
from app.engine.catalog import CHANNELS, SEGMENTS
from app.models import Application, Communication, Consent, JourneyEvent, JourneySession, Organization, User
from app.models.enums import AppStatus, CommStatus
from app.services.access import org_scope
from app.services.rules import active_rules


def _rate(a: int, b: int) -> float | None:
    return round(a / b, 4) if b else None


def z_test(c1: int, n1: int, c2: int, n2: int) -> dict[str, float | None]:
    """Двусторонний z-тест для разницы долей (тест vs контроль)."""
    if not n1 or not n2:
        return {"z": None, "p_value": None}
    p1, p2 = c1 / n1, c2 / n2
    p = (c1 + c2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
    if se == 0:
        return {"z": None, "p_value": None}
    z = (p1 - p2) / se
    return {"z": round(z, 3), "p_value": round(math.erfc(abs(z) / math.sqrt(2)), 4)}


def _org_segments(o: Organization, high_min: int) -> list[str]:
    seg = []
    if o.group_id:
        seg.append("S1")
    if o.seasonal and o.industry.value in ("agro", "retail"):
        seg.append("S2")
    if o.logins_30d >= high_min:
        seg.append("S3")
    if o.industry.value == "trade":
        seg.append("S4")
    return seg


def _block(rows: list[Communication], deals: set[int]) -> dict[str, Any]:
    shown = [c for c in rows if c.shown_at]
    clicked = [c for c in rows if c.clicked_at]
    conv = [c for c in rows if c.converted_at]
    tta = [(c.converted_at - c.shown_at).total_seconds() / 3600 for c in conv if c.shown_at and c.converted_at >= c.shown_at]
    return {
        "delivered": len(rows),
        "shown": len(shown),
        "clicked": len(clicked),
        "converted": len(conv),
        "hidden": sum(1 for c in rows if c.hidden_at),
        "deals": sum(1 for c in conv if c.id in deals),
        "ctr": _rate(len(clicked), len(shown)),
        "cr": _rate(len(conv), len(shown)),
        "view_to_deal": _rate(sum(1 for c in conv if c.id in deals), len(shown)),
        "time_to_action_hours": round(median(tta), 1) if tta else None,
    }


async def overview(session: AsyncSession, user: User, days: int = 90) -> dict[str, Any]:
    _, cfg = await active_rules(session)
    now = utcnow()
    since = now - timedelta(days=days)
    comms = list((await session.execute(
        select(Communication).where(Communication.created_at >= since, org_scope(user, Communication.org_id))
    )).scalars())
    sent = [c for c in comms if c.status != CommStatus.blocked]
    blocked = [c for c in comms if c.status == CommStatus.blocked]
    deals = set((await session.execute(
        select(Application.communication_id).where(Application.status == AppStatus.approved, Application.communication_id.is_not(None),
                                                  Application.created_at >= since)
    )).scalars())
    orgs = {o.id: o for o in (await session.execute(select(Organization).where(org_scope(user, Organization.id)))).scalars()}

    by_variant = {v: _block([c for c in sent if c.variant.value == v], deals) for v in ("test", "control")}
    t, c = by_variant["test"], by_variant["control"]
    weeks = max(1.0, days / 7)
    for v in ("test", "control"):
        rows = [x for x in sent if x.variant.value == v and x.group_id]
        groups = {x.group_id for x in rows}
        by_variant[v]["messages_per_group_week"] = round(len(rows) / len(groups) / weeks, 2) if groups else None

    optouts = list((await session.execute(
        select(Consent).where(Consent.opted_out.is_(True), Consent.updated_at >= since, org_scope(user, Consent.org_id))
    )).scalars())
    for v in ("test", "control"):
        by_variant[v]["opt_outs"] = sum(1 for x in optouts if x.org_id in orgs and orgs[x.org_id].effective_variant.value == v)
        n_orgs = sum(1 for o in orgs.values() if o.effective_variant.value == v)
        by_variant[v]["organizations"] = n_orgs

    segments = []
    for code, name in SEGMENTS.items():
        seg_rows = [x for x in sent if x.org_id in orgs and code in _org_segments(orgs[x.org_id], cfg.activity.high_min)]
        st = _block([x for x in seg_rows if x.variant.value == "test"], deals)
        sc = _block([x for x in seg_rows if x.variant.value == "control"], deals)
        segments.append({"code": code, "name": name, "test": st, "control": sc,
                         "uplift_cr": round((st["cr"] - sc["cr"]) / sc["cr"], 3) if st["cr"] is not None and sc["cr"] else None})

    channels = []
    for code, name in CHANNELS.items():
        rows = [x for x in sent if x.channel.value == code]
        if rows:
            channels.append({"code": code, "name": name, **_block(rows, deals)})

    weekly: dict[str, dict[str, list[int]]] = defaultdict(lambda: {"test": [0, 0], "control": [0, 0]})
    for x in sent:
        if x.shown_at:
            y, w, _ = x.shown_at.isocalendar()
            key = f"{y}-W{w:02d}"
            weekly[key][x.variant.value][0] += 1
            weekly[key][x.variant.value][1] += 1 if x.converted_at else 0
    series = [
        {"week": k, "test_cr": _rate(v["test"][1], v["test"][0]), "control_cr": _rate(v["control"][1], v["control"][0]),
         "test_shown": v["test"][0], "control_shown": v["control"][0]}
        for k, v in sorted(weekly.items())
    ][-16:]

    submitted = list((await session.execute(
        select(Application).where(Application.created_at >= since, Application.status != AppStatus.draft, org_scope(user, Application.org_id))
    )).scalars())
    comm_variant = {x.id: x.variant.value for x in sent}
    funnel = {}
    for v in ("test", "control"):
        attributed = [a for a in submitted if a.communication_id in comm_variant and comm_variant[a.communication_id] == v]
        funnel[v] = {
            "shown": by_variant[v]["shown"],
            "clicked": by_variant[v]["clicked"],
            "applications": len(attributed),
            "approved": sum(1 for a in attributed if a.status == AppStatus.approved),
        }

    js_query = select(JourneySession).where(JourneySession.started_at >= since, org_scope(user, JourneySession.org_id))
    settings = get_settings()
    if settings.demo_mode and settings.is_production:
        # Публичное демо: клики зрителей не двигают UX-метрики — считаем по синтетическим сессиям сида (без пользователя)
        js_query = js_query.where(JourneySession.user_id.is_(None))
    sessions = list((await session.execute(js_query)).scalars())
    sid = [s.id for s in sessions]
    reached: dict[int, set[str]] = defaultdict(set)
    if sid:
        for s_id, screen in (await session.execute(
            select(JourneyEvent.session_id, JourneyEvent.screen).where(JourneyEvent.session_id.in_(sid), JourneyEvent.kind == "view")
        )).all():
            if screen:
                reached[s_id].add(screen)
    journey = {}
    for flag, label in ((True, "adaptive"), (False, "static")):
        # Незавершённые сессии (outcome open) не считаем: их исход ещё неизвестен, иначе они занижают долю дошедших
        ss = [s for s in sessions if s.adapt == flag and s.outcome != "open"]
        applied = [s for s in ss if s.outcome == "applied"]
        calc = [s for s in ss if "calc" in reached[s.id] or s.recalcs > 0]
        # Drop-off «калькулятор → заявка»: дошёл до калькулятора, но заявку не отправил
        to_form = [s for s in calc if s.outcome == "applied"]
        times = [s.time_to_apply_sec for s in applied if s.time_to_apply_sec is not None]
        journey[label] = {
            "sessions": len(ss),
            "applied": len(applied),
            "apply_rate": _rate(len(applied), len(ss)),
            "median_time_to_apply_sec": int(median(times)) if times else None,
            "calc_sessions": len(calc),
            "dropoff_calc_to_form": _rate(len(calc) - len(to_form), len(calc)),
            "hints_shown": sum(s.hints_shown for s in ss),
            "hints_closed": sum(s.hints_closed for s in ss),
        }

    blocked_reasons: dict[str, int] = defaultdict(int)
    for x in blocked:
        blocked_reasons[(x.blocked_reason or "—").split(":")[0]] += 1

    return {
        "period_days": days,
        "generated_at": now.isoformat(),
        "variants": by_variant,
        "uplift": {
            "ctr": round((t["ctr"] - c["ctr"]) / c["ctr"], 3) if t["ctr"] is not None and c["ctr"] else None,
            "cr": round((t["cr"] - c["cr"]) / c["cr"], 3) if t["cr"] is not None and c["cr"] else None,
        },
        "significance_cr": z_test(t["converted"], t["shown"], c["converted"], c["shown"]),
        "segments": segments,
        "channels": channels,
        "weekly": series,
        "funnel": funnel,
        "journey": journey,
        "blocked_by_policy": dict(blocked_reasons),
        "disclaimer": "Данные синтетические: показатели демонстрируют расчёт метрик, а не результат пилота.",
    }
