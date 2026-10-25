"""Заявки и задачи."""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api import idempotency
from app.api.deps import DB, CurrentUser, Staff, client_ip, paginated, reload
from app.api.serializers import app_out, change_out, comment_out, task_out
from app.models import Application, Task
from app.models.enums import AppSource, AppStatus, Priority, TaskKind, TaskStatus
from app.services import applications as app_svc
from app.services import tasks as task_svc

router = APIRouter(tags=["work"])


class ApplicationIn(BaseModel):
    org_id: int | None = None
    product_code: Annotated[str, Field(max_length=32)]
    amount_rub: Annotated[int, Field(ge=1)]
    term_months: Annotated[int, Field(ge=1, le=360)]
    comment: Annotated[str, Field(max_length=2000)] | None = None
    source: Literal["web", "miniapp"] = "web"
    communication_id: int | None = None
    journey_session_id: int | None = None
    draft: bool = False


class ApplicationPatch(BaseModel):
    amount_rub: Annotated[int, Field(ge=1)] | None = None
    term_months: Annotated[int, Field(ge=1, le=360)] | None = None
    comment: Annotated[str, Field(max_length=2000)] | None = None


class StatusIn(BaseModel):
    status: AppStatus
    comment: Annotated[str, Field(max_length=2000)] | None = None
    journey_session_id: int | None = None


class AssignIn(BaseModel):
    user_id: int | None = None


class CommentIn(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=4000)]
    internal: bool = False


class TaskIn(BaseModel):
    org_id: int
    title: Annotated[str, Field(min_length=3, max_length=200)]
    description: Annotated[str, Field(max_length=4000)] = ""
    priority: Priority = Priority.normal
    due_at: datetime | None = None
    assignee_id: int | None = None


class TaskPatch(BaseModel):
    title: Annotated[str, Field(min_length=3, max_length=200)] | None = None
    description: Annotated[str, Field(max_length=4000)] | None = None
    priority: Priority | None = None
    due_at: datetime | None = None
    clear_due: bool = False


class TaskStatusIn(BaseModel):
    status: TaskStatus
    comment: Annotated[str, Field(max_length=2000)] | None = None


async def _app_detail(db: DB, user: CurrentUser, app_id: int) -> dict:
    a = await app_svc.get_application(db, user, app_id)
    hist = await task_svc.history(db, "application", a.id)
    return {**app_out(a), "history": [change_out(c, app_svc.STATUS_NAMES) for c in hist],
            "comments": [comment_out(c) for c in await app_svc.comments(db, user, a.id)]}


@router.get("/applications")
async def list_applications(
    user: CurrentUser, db: DB,
    status: Annotated[list[AppStatus] | None, Query()] = None,
    org_id: int | None = None,
    product: Annotated[str | None, Query(max_length=32)] = None,
    assignee: Literal["me"] | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    sort: Literal["-created", "created", "-amount", "-updated"] = "-created",
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    items, total = await app_svc.list_applications(db, user, statuses=status, org_id=org_id, product=product, assignee=assignee,
                                                   search=search, page=page, size=size, sort=sort)
    return paginated([app_out(a) for a in items], total, page, size)


@router.post("/applications", status_code=201, response_model=None)
async def create_application(body: ApplicationIn, request: Request, user: CurrentUser, db: DB) -> dict | JSONResponse:
    idem = await idempotency.begin(db, request, user, "applications.create")
    if isinstance(idem, JSONResponse):
        return idem
    a = await app_svc.create_application(db, user, org_id=body.org_id, product_code=body.product_code, amount_rub=body.amount_rub,
                                         term_months=body.term_months, comment=body.comment, source=AppSource(body.source),
                                         communication_id=body.communication_id, journey_session_id=body.journey_session_id,
                                         draft=body.draft, ip=client_ip(request))
    await db.flush()
    await reload(db, Application, a.id)
    out = await _app_detail(db, user, a.id)
    idempotency.finish(idem, out, 201)
    await db.commit()
    return out


@router.get("/applications/{app_id}")
async def get_application(app_id: int, user: CurrentUser, db: DB) -> dict:
    return await _app_detail(db, user, app_id)


@router.patch("/applications/{app_id}")
async def patch_application(app_id: int, body: ApplicationPatch, user: CurrentUser, db: DB) -> dict:
    await app_svc.update_draft(db, user, app_id, amount_rub=body.amount_rub, term_months=body.term_months, comment=body.comment)
    await db.commit()
    return await _app_detail(db, user, app_id)


@router.post("/applications/{app_id}/status")
async def application_status(app_id: int, body: StatusIn, request: Request, user: CurrentUser, db: DB) -> dict:
    await app_svc.change_status(db, user, app_id, body.status, body.comment, journey_session_id=body.journey_session_id, ip=client_ip(request))
    await db.commit()
    await reload(db, Application, app_id)
    return await _app_detail(db, user, app_id)


@router.post("/applications/{app_id}/assign")
async def application_assign(app_id: int, body: AssignIn, user: Staff, db: DB) -> dict:
    await app_svc.assign(db, user, app_id, body.user_id or user.id)
    await db.commit()
    await reload(db, Application, app_id)
    return await _app_detail(db, user, app_id)


@router.post("/applications/{app_id}/comments", status_code=201, response_model=None)
async def application_comment(app_id: int, body: CommentIn, request: Request, user: CurrentUser, db: DB) -> dict | JSONResponse:
    idem = await idempotency.begin(db, request, user, f"applications.comment.{app_id}")
    if isinstance(idem, JSONResponse):
        return idem
    await app_svc.add_comment(db, user, app_id, body.body, body.internal)
    await db.flush()
    out = await _app_detail(db, user, app_id)
    idempotency.finish(idem, out, 201)
    await db.commit()
    return out


async def _task_detail(db: DB, user: CurrentUser, task_id: int) -> dict:
    t = await task_svc.get_task(db, user, task_id)
    hist = await task_svc.history(db, "task", t.id)
    return {**task_out(t), "history": [change_out(c, task_svc.TASK_STATUS_NAMES) for c in hist]}


@router.get("/tasks")
async def list_tasks(
    user: Staff, db: DB,
    status: Annotated[list[TaskStatus] | None, Query()] = None,
    assignee: Literal["me", "none"] | None = None,
    org_id: int | None = None,
    kind: TaskKind | None = None,
    priority: Priority | None = None,
    overdue: bool = False,
    search: Annotated[str | None, Query(max_length=100)] = None,
    sort: Literal["due", "-created", "priority"] = "due",
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    items, total = await task_svc.list_tasks(db, user, page=page, size=size, sort=sort, statuses=status, assignee=assignee, org_id=org_id,
                                             kind=kind, priority=priority, overdue=overdue, search=search)
    return paginated([task_out(t) for t in items], total, page, size)


@router.post("/tasks", status_code=201)
async def create_task(body: TaskIn, user: Staff, db: DB) -> dict:
    t = await task_svc.create_manual(db, user, org_id=body.org_id, title=body.title, description=body.description, priority=body.priority,
                                     due_at=body.due_at, assignee_id=body.assignee_id)
    await db.commit()
    await reload(db, Task, t.id)
    return await _task_detail(db, user, t.id)


@router.get("/tasks/{task_id}")
async def get_task(task_id: int, user: Staff, db: DB) -> dict:
    return await _task_detail(db, user, task_id)


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: int, body: TaskPatch, user: Staff, db: DB) -> dict:
    await task_svc.update_task(db, user, task_id, title=body.title, description=body.description, priority=body.priority,
                               due_at=body.due_at, clear_due=body.clear_due)
    await db.commit()
    return await _task_detail(db, user, task_id)


@router.post("/tasks/{task_id}/status")
async def task_status(task_id: int, body: TaskStatusIn, user: Staff, db: DB) -> dict:
    await task_svc.change_status(db, user, task_id, body.status, body.comment)
    await db.commit()
    await reload(db, Task, task_id)
    return await _task_detail(db, user, task_id)


@router.post("/tasks/{task_id}/assign")
async def task_assign(task_id: int, body: AssignIn, user: Staff, db: DB) -> dict:
    await task_svc.assign(db, user, task_id, body.user_id)
    await db.commit()
    await reload(db, Task, task_id)
    return await _task_detail(db, user, task_id)
