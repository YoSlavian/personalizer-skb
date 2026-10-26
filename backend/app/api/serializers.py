"""Преобразование моделей в JSON-ответы API. Чувствительные поля (хеши, токены) никогда не попадают в ответы."""

from datetime import datetime
from typing import Any

from app.db import utcnow
from app.engine.catalog import PRODUCTS, ROLES, SIGNALS, industry_name, product_name
from app.engine.rules import RulesConfig
from app.engine.scoring import activity_level
from app.models import (
    Application,
    ApplicationComment,
    AuditEvent,
    CampaignRun,
    Communication,
    Contact,
    Decision,
    Notification,
    Organization,
    RuleSet,
    StatusChange,
    Task,
    User,
)
from app.demo_accounts import DEMO_EMAILS
from app.models.enums import TaskStatus, UserRole
from app.services.applications import STATUS_NAMES
from app.services.orgs import consent_map
from app.services.profiles import infer_role, primary_contact
from app.services.tasks import TASK_KIND_NAMES, TASK_STATUS_NAMES


def dt(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


def user_brief(u: User | None) -> dict | None:
    if u is None:
        return None
    return {"id": u.id, "full_name": u.full_name, "role": u.role.value}


def user_out(u: User) -> dict:
    s = u.settings
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role.value,
        "is_active": u.is_active,
        "created_at": dt(u.created_at),
        "last_login_at": dt(u.last_login_at),
        "settings": {
            "notify_telegram": s.notify_telegram if s else True,
            "notify_applications": s.notify_applications if s else True,
            "notify_tasks": s.notify_tasks if s else True,
            "notify_offers": s.notify_offers if s else True,
            "adaptive_hints": s.adaptive_hints if s else True,
        },
        # Демо-учётками пользуются разные люди: чужие Telegram-логины видит только администратор
        "telegram": [{"id": t.id, "username": t.username if (u.role == UserRole.admin or u.email not in DEMO_EMAILS) else None,
                      "linked_at": dt(t.linked_at), "via": t.via} for t in u.telegram_links],
    }


def contact_out(c: Contact) -> dict:
    ri = infer_role(c)
    return {
        "id": c.id,
        "label": c.label,
        "crm_position": c.crm_position.value if c.crm_position else None,
        "ib_rights": c.ib_rights.value if c.ib_rights else None,
        "boss_access": c.boss_access,
        "is_primary": c.is_primary,
        "user": user_brief(c.user),
        "role": ri.role,
        "role_name": ROLES[ri.role].name if ri.role else "Не указана",
        "role_source": ri.source,
        "role_explanation": ri.explanation,
    }


def org_brief(o: Organization | None) -> dict | None:
    if o is None:
        return None
    return {"id": o.id, "name": o.name, "industry": o.industry.value, "industry_name": industry_name(o.industry.value)}


def org_out(o: Organization, cfg: RulesConfig, *, open_tasks: int = 0) -> dict:
    pc = primary_contact(o)
    ri = infer_role(pc)
    now = utcnow()
    segs = []
    if o.group_id:
        segs.append("S1")
    if o.seasonal and o.industry.value in ("agro", "retail"):
        segs.append("S2")
    if o.logins_30d >= cfg.activity.high_min:
        segs.append("S3")
    if o.industry.value == "trade":
        segs.append("S4")
    completeness = {"crm": 40, "inferred": 25, "none": 0}[ri.source] + (0 if o.industry.value == "unk" else 20) + 40
    return {
        "id": o.id,
        "name": o.name,
        "inn": o.inn,
        "industry": o.industry.value,
        "industry_name": industry_name(o.industry.value),
        "okved": o.okved,
        "revenue_mln": o.revenue_mln,
        "size": o.size,
        "seasonal": o.seasonal,
        "turnover_by_month": o.turnover_by_month,
        "logins_30d": o.logins_30d,
        "activity_level": activity_level(o.logins_30d, cfg),
        "balance_kind": o.balance_kind.value if o.balance_kind else None,
        "group": {"id": o.group.id, "name": o.group.name, "ab_variant": o.group.ab_variant.value} if o.group else None,
        "head_of_group": o.head_of_group,
        "ab_variant": o.effective_variant.value,
        "manager": user_brief(o.manager),
        "primary_role": ri.role,
        "primary_role_name": ROLES[ri.role].name if ri.role else "Не указана",
        "role_source": ri.source,
        "completeness": completeness,
        "segments": segs,
        "signals": [
            {"id": s.id, "kind": s.kind.value, "name": SIGNALS[s.kind.value], "note": s.note, "expires_at": dt(s.expires_at)}
            for s in o.signals if s.expires_at > now
        ],
        "consents": consent_map(o),
        "open_tasks": open_tasks,
        "is_synthetic": o.is_synthetic,
        "updated_at": dt(o.updated_at),
    }


def app_out(a: Application) -> dict:
    return {
        "id": a.id,
        "number": a.number,
        "organization": org_brief(a.organization),
        "product_code": a.product_code,
        "product_name": product_name(a.product_code),
        "amount_rub": a.amount_rub,
        "term_months": a.term_months,
        "comment": a.comment,
        "status": a.status.value,
        "status_name": STATUS_NAMES[a.status],
        "source": a.source.value,
        "author": user_brief(a.author),
        "assignee": user_brief(a.assignee),
        "communication_id": a.communication_id,
        "created_at": dt(a.created_at),
        "updated_at": dt(a.updated_at),
        "submitted_at": dt(a.submitted_at),
        "decided_at": dt(a.decided_at),
    }


def change_out(c: StatusChange, names: dict | None = None) -> dict:
    def nm(s: str | None) -> str | None:
        if s is None:
            return None
        if names:
            for k, v in names.items():
                if k.value == s:
                    return v
        return s

    return {"id": c.id, "from_status": c.from_status, "to_status": c.to_status, "from_name": nm(c.from_status), "to_name": nm(c.to_status),
            "actor": user_brief(c.actor), "comment": c.comment, "created_at": dt(c.created_at)}


def comment_out(c: ApplicationComment) -> dict:
    return {"id": c.id, "body": c.body, "internal": c.internal, "author": user_brief(c.author), "created_at": dt(c.created_at)}


def task_out(t: Task) -> dict:
    now = utcnow()
    return {
        "id": t.id,
        "organization": org_brief(t.organization),
        "kind": t.kind.value,
        "kind_name": TASK_KIND_NAMES[t.kind],
        "title": t.title,
        "description": t.description,
        "priority": t.priority.value,
        "status": t.status.value,
        "status_name": TASK_STATUS_NAMES[t.status],
        "source": t.source,
        "assignee": user_brief(t.assignee),
        "due_at": dt(t.due_at),
        "overdue": bool(t.due_at and t.due_at < now and t.status in (TaskStatus.open, TaskStatus.in_progress)),
        "application_id": t.application_id,
        "result": t.result,
        "created_at": dt(t.created_at),
        "updated_at": dt(t.updated_at),
        "completed_at": dt(t.completed_at),
    }


def comm_out(c: Communication) -> dict:
    return {
        "id": c.id,
        "organization": org_brief(c.organization),
        "campaign_run_id": c.campaign_run_id,
        "variant": c.variant.value,
        "product_code": c.product_code,
        "product_name": product_name(c.product_code),
        "channel": c.channel.value,
        "recipient": c.recipient,
        "headline": c.headline,
        "body": c.body,
        "cta": c.cta,
        "visual": c.visual,
        "status": c.status.value,
        "blocked_reason": c.blocked_reason,
        "clicks": c.clicks,
        "created_at": dt(c.created_at),
        "sent_at": dt(c.sent_at),
        "shown_at": dt(c.shown_at),
        "clicked_at": dt(c.clicked_at),
        "hidden_at": dt(c.hidden_at),
        "converted_at": dt(c.converted_at),
    }


def notification_out(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind.value, "title": n.title, "body": n.body, "link": n.link, "is_read": n.is_read,
            "created_at": dt(n.created_at), "telegram": n.tg_status}


def run_out(r: CampaignRun) -> dict:
    return {"id": r.id, "started_by": user_brief(r.author), "started_at": dt(r.started_at), "finished_at": dt(r.finished_at),
            "rule_version": r.rule_version, "scope": r.scope, "stats": r.stats}


def rule_set_out(r: RuleSet, with_config: bool = False) -> dict:
    out: dict[str, Any] = {"id": r.id, "version": r.version, "comment": r.comment, "is_active": r.is_active,
                           "author": user_brief(r.author), "created_at": dt(r.created_at)}
    if with_config:
        out["config"] = r.config
    return out


def audit_out(e: AuditEvent, actor: User | None = None) -> dict:
    return {"id": e.id, "action": e.action, "entity_type": e.entity_type, "entity_id": e.entity_id, "org_id": e.org_id,
            "details": e.details, "ip": e.ip, "actor": user_brief(actor), "actor_id": e.actor_id, "created_at": dt(e.created_at)}


def decision_out(d: Decision) -> dict:
    r = d.result or {}
    offer = r.get("offer") or {}
    return {"id": d.id, "org_id": d.org_id, "rule_version": d.rule_version, "variant": d.variant.value, "trigger": d.trigger,
            "product_code": d.product_code, "product_name": PRODUCTS[d.product_code].name if d.product_code in PRODUCTS else None,
            "headline": offer.get("headline"), "channels": [c["label"] for c in r.get("channels", [])], "nba": r.get("nba"),
            "recipient": r.get("recipient"), "created_at": dt(d.created_at)}
