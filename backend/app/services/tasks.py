"""Задачи клиентских менеджеров: создаются правилами, событиями пути, заявками или вручную."""

from datetime import datetime, timedelta

from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import like_pattern
from app.db import utcnow
from app.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import Organization, StatusChange, Task, User
from app.models.enums import NotificationKind, Priority, TaskKind, TaskStatus, UserRole
from app.services.access import get_org, org_scope
from app.services.audit import audit
from app.services.notifications import notify

TASK_KIND_NAMES = {
    TaskKind.call_48h: "Звонок за 48 часов",
    TaskKind.update_crm_role: "Уточнить роль в CRM",
    TaskKind.meeting: "Звонок или встреча",
    TaskKind.hesitation: "Клиент сомневается",
    TaskKind.application_review: "Рассмотреть заявку",
    TaskKind.group_offer: "Комплексное предложение",
    TaskKind.manual: "Задача",
}
TASK_STATUS_NAMES = {
    TaskStatus.open: "Новая",
    TaskStatus.in_progress: "В работе",
    TaskStatus.done: "Выполнена",
    TaskStatus.cancelled: "Отменена",
}
TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.open: {TaskStatus.in_progress, TaskStatus.done, TaskStatus.cancelled},
    TaskStatus.in_progress: {TaskStatus.done, TaskStatus.cancelled, TaskStatus.open},
    TaskStatus.done: {TaskStatus.in_progress},
    TaskStatus.cancelled: {TaskStatus.open},
}


async def create_task(
    session: AsyncSession,
    *,
    org: Organization,
    kind: TaskKind,
    title: str,
    description: str = "",
    priority: Priority = Priority.normal,
    due_hours: int | None = None,
    source: str,
    actor_id: int | None = None,
    assignee_id: int | None = None,
    application_id: int | None = None,
    dedupe_key: str | None = None,
    now: datetime | None = None,
) -> tuple[Task, bool]:
    """Создаёт задачу. Повторное событие с тем же dedupe_key возвращает существующую задачу (created=False)."""
    if dedupe_key:
        existing = (await session.execute(select(Task).where(Task.dedupe_key == dedupe_key))).scalar_one_or_none()
        if existing:
            return existing, False
    now = now or utcnow()
    task = Task(
        org_id=org.id,
        assignee_id=assignee_id if assignee_id is not None else org.manager_id,
        created_by=actor_id,
        kind=kind,
        title=title[:200],
        description=description,
        priority=priority,
        status=TaskStatus.open,
        source=source,
        due_at=now + timedelta(hours=due_hours) if due_hours else None,
        application_id=application_id,
        dedupe_key=dedupe_key,
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    await session.flush()
    session.add(StatusChange(entity_type="task", entity_id=task.id, from_status=None, to_status=TaskStatus.open.value, actor_id=actor_id, created_at=now))
    if task.assignee_id:
        await notify(
            session,
            [task.assignee_id],
            kind=NotificationKind.task,
            title=f"Новая задача: {task.title}",
            body=f"{org.name}. {description}".strip(),
            link=f"/tasks/{task.id}",
            entity_type="task",
            entity_id=task.id,
            tg_payload={"type": "task", "task_id": task.id},
            exclude=actor_id,
        )
    return task, True


def _filtered(user: User, *, statuses: list[TaskStatus] | None, assignee: str | None, org_id: int | None,
              kind: TaskKind | None, priority: Priority | None, overdue: bool, search: str | None) -> Select:
    q = select(Task).where(org_scope(user, Task.org_id))
    if statuses:
        q = q.where(Task.status.in_(statuses))
    if assignee == "me":
        q = q.where(Task.assignee_id == user.id)
    elif assignee == "none":
        q = q.where(Task.assignee_id.is_(None))
    if org_id:
        q = q.where(Task.org_id == org_id)
    if kind:
        q = q.where(Task.kind == kind)
    if priority:
        q = q.where(Task.priority == priority)
    if overdue:
        q = q.where(Task.due_at < utcnow(), Task.status.in_([TaskStatus.open, TaskStatus.in_progress]))
    if search:
        like = like_pattern(search)
        q = q.join(Organization, Organization.id == Task.org_id).where(or_(Task.title.ilike(like, escape="\\"), Organization.name.ilike(like, escape="\\")))
    return q


async def list_tasks(session: AsyncSession, user: User, *, page: int, size: int, sort: str, **filters) -> tuple[list[Task], int]:
    q = _filtered(user, **filters)
    total = (await session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    order = {
        "due": [Task.due_at.is_(None), Task.due_at.asc(), Task.id.desc()],
        "-created": [Task.created_at.desc(), Task.id.desc()],
        "priority": [case({"high": 0, "normal": 1, "low": 2}, value=Task.priority), Task.due_at.asc()],
    }.get(sort, [Task.created_at.desc()])
    items = (await session.execute(q.order_by(*order).offset((page - 1) * size).limit(size))).scalars().all()
    return list(items), total


async def get_task(session: AsyncSession, user: User, task_id: int) -> Task:
    t = (await session.execute(select(Task).where(Task.id == task_id, org_scope(user, Task.org_id)))).scalar_one_or_none()
    if t is None:
        raise NotFound("Задача не найдена")
    return t


async def history(session: AsyncSession, entity_type: str, entity_id: int) -> list[StatusChange]:
    q = select(StatusChange).where(and_(StatusChange.entity_type == entity_type, StatusChange.entity_id == entity_id)).order_by(StatusChange.created_at, StatusChange.id)
    return list((await session.execute(q)).scalars())


def _can_modify(user: User, task: Task) -> None:
    if user.role == UserRole.client:
        raise Forbidden("Клиенты не работают с задачами")
    if user.role == UserRole.manager and task.assignee_id not in (None, user.id):
        raise Forbidden("Задача назначена другому менеджеру")


async def change_status(session: AsyncSession, user: User, task_id: int, status: TaskStatus, comment: str | None = None) -> Task:
    task = await get_task(session, user, task_id)
    _can_modify(user, task)
    if status == task.status:
        raise Conflict(f"Задача уже в статусе «{TASK_STATUS_NAMES[status]}»", code="no_change")
    if status not in TRANSITIONS[task.status]:
        raise ValidationFailed(f"Нельзя перевести задачу из «{TASK_STATUS_NAMES[task.status]}» в «{TASK_STATUS_NAMES[status]}»")
    if status == TaskStatus.done and task.kind == TaskKind.update_crm_role and not (comment or "").strip():
        raise ValidationFailed("Укажите, какую роль уточнили в CRM")
    prev = task.status
    task.status = status
    now = utcnow()
    task.updated_at = now
    if status == TaskStatus.in_progress and task.assignee_id is None:
        task.assignee_id = user.id
    if status in (TaskStatus.done, TaskStatus.cancelled):
        task.completed_at = now
        task.result = (comment or "").strip() or task.result
    else:
        task.completed_at = None
    session.add(StatusChange(entity_type="task", entity_id=task.id, from_status=prev.value, to_status=status.value, actor_id=user.id, comment=comment, created_at=now))
    audit(session, actor_id=user.id, action="task.status", entity_type="task", entity_id=task.id, org_id=task.org_id, details={"from": prev.value, "to": status.value})
    await session.flush()
    return task


async def update_task(session: AsyncSession, user: User, task_id: int, *, title: str | None, description: str | None,
                      priority: Priority | None, due_at: datetime | None, clear_due: bool) -> Task:
    task = await get_task(session, user, task_id)
    _can_modify(user, task)
    changes = {}
    if title is not None and title.strip() != task.title:
        task.title, changes["title"] = title.strip()[:200], True
    if description is not None:
        task.description, changes["description"] = description, True
    if priority is not None and priority != task.priority:
        changes["priority"] = [task.priority.value, priority.value]
        task.priority = priority
    if clear_due:
        task.due_at, changes["due_at"] = None, None
    elif due_at is not None:
        task.due_at, changes["due_at"] = due_at, due_at.isoformat()
    if changes:
        task.updated_at = utcnow()
        audit(session, actor_id=user.id, action="task.update", entity_type="task", entity_id=task.id, org_id=task.org_id, details=changes)
    await session.flush()
    return task


async def assign(session: AsyncSession, user: User, task_id: int, assignee_id: int | None) -> Task:
    task = await get_task(session, user, task_id)
    if user.role not in (UserRole.admin, UserRole.analyst, UserRole.manager):
        raise Forbidden("Недостаточно прав")
    if user.role == UserRole.manager and assignee_id not in (user.id, None):
        raise Forbidden("Менеджер может взять задачу только на себя")
    if assignee_id is not None:
        assignee = await session.get(User, assignee_id)
        if assignee is None or assignee.role not in (UserRole.manager, UserRole.admin) or not assignee.is_active:
            raise ValidationFailed("Исполнителем может быть только активный менеджер")
    prev = task.assignee_id
    task.assignee_id = assignee_id
    task.updated_at = utcnow()
    audit(session, actor_id=user.id, action="task.assign", entity_type="task", entity_id=task.id, org_id=task.org_id, details={"from": prev, "to": assignee_id})
    if assignee_id and assignee_id != user.id:
        await notify(session, [assignee_id], kind=NotificationKind.task, title=f"Вам назначена задача: {task.title}",
                     body=task.organization.name, link=f"/tasks/{task.id}", entity_type="task", entity_id=task.id,
                     tg_payload={"type": "task", "task_id": task.id})
    await session.flush()
    return task


async def create_manual(session: AsyncSession, user: User, *, org_id: int, title: str, description: str, priority: Priority,
                        due_at: datetime | None, assignee_id: int | None) -> Task:
    if user.role == UserRole.client:
        raise Forbidden("Клиенты не создают задачи")
    org = await get_org(session, user, org_id)
    if user.role == UserRole.manager:
        assignee_id = user.id
    task, _ = await create_task(session, org=org, kind=TaskKind.manual, title=title, description=description, priority=priority,
                                source="manual", actor_id=user.id, assignee_id=assignee_id or org.manager_id)
    if due_at:
        task.due_at = due_at
    audit(session, actor_id=user.id, action="task.create", entity_type="task", entity_id=task.id, org_id=org.id)
    await session.flush()
    return task


async def close_application_tasks(session: AsyncSession, application_id: int, actor_id: int | None, result: str) -> None:
    tasks = (await session.execute(select(Task).where(Task.application_id == application_id, Task.status.in_([TaskStatus.open, TaskStatus.in_progress])))).scalars()
    now = utcnow()
    for t in tasks:
        session.add(StatusChange(entity_type="task", entity_id=t.id, from_status=t.status.value, to_status=TaskStatus.done.value, actor_id=actor_id, comment=result, created_at=now))
        t.status, t.completed_at, t.result, t.updated_at = TaskStatus.done, now, result, now
