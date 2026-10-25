"""Главная панель сотрудника: ключевые показатели, задачи, заявки, события."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.models import Application, CampaignRun, Task, User
from app.models.enums import AppStatus, TaskStatus, UserRole
from app.services.access import org_scope
from app.services.analytics import overview
from app.services.notifications import list_for


async def staff_dashboard(session: AsyncSession, user: User) -> dict[str, Any]:
    now = utcnow()
    active = [TaskStatus.open, TaskStatus.in_progress]
    task_q = select(Task).where(org_scope(user, Task.org_id), Task.status.in_(active))
    if user.role == UserRole.manager:
        task_q = task_q.where(Task.assignee_id == user.id)
    open_tasks = (await session.execute(select(func.count()).select_from(task_q.subquery()))).scalar_one()
    overdue = (await session.execute(select(func.count()).select_from(task_q.where(Task.due_at < now).subquery()))).scalar_one()
    my_tasks = (await session.execute(task_q.order_by(Task.due_at.is_(None), Task.due_at.asc()).limit(5))).scalars().all()
    app_q = select(Application).where(org_scope(user, Application.org_id), Application.status.in_([AppStatus.submitted, AppStatus.in_review, AppStatus.needs_info]))
    open_apps = (await session.execute(select(func.count()).select_from(app_q.subquery()))).scalar_one()
    recent_apps = (await session.execute(
        select(Application).where(org_scope(user, Application.org_id), Application.status != AppStatus.draft).order_by(Application.updated_at.desc()).limit(5)
    )).scalars().all()
    stats = await overview(session, user, days=30)
    runs = []
    if user.role in (UserRole.admin, UserRole.analyst):
        runs = (await session.execute(select(CampaignRun).order_by(CampaignRun.started_at.desc()).limit(3))).scalars().all()
    notes, _ = await list_for(session, user, unread_only=False, page=1, size=6)
    t, c = stats["variants"]["test"], stats["variants"]["control"]
    return {
        "kpi": {
            "open_tasks": open_tasks,
            "overdue_tasks": overdue,
            "open_applications": open_apps,
            "cr_test": t["cr"],
            "cr_control": c["cr"],
            "ctr_test": t["ctr"],
            "ctr_control": c["ctr"],
            "uplift_cr": stats["uplift"]["cr"],
            "opt_outs_30d": t["opt_outs"] + c["opt_outs"],
            "time_to_action_test": t["time_to_action_hours"],
            "time_to_action_control": c["time_to_action_hours"],
        },
        "tasks": my_tasks,
        "applications": recent_apps,
        "runs": runs,
        "notifications": notes,
        "weekly": stats["weekly"][-8:],
        "disclaimer": stats["disclaimer"],
    }
