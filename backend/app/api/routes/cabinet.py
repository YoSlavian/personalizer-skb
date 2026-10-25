"""Кабинет клиента и адаптивный путь."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from app.api.deps import DB, Client, client_ip
from app.api.serializers import app_out
from app.models.enums import ConsentChannel
from app.services import cabinet as cab_svc
from app.services import journey as j_svc
from app.services.access import client_contact
from app.services.communications import register_interaction
from app.services.orgs import consent_map, set_consents
from app.services.access import get_org

router = APIRouter(prefix="/cabinet", tags=["cabinet"])


class OfferEventIn(BaseModel):
    kind: Literal["shown", "clicked", "hidden", "unsubscribe_push"]


class ConsentsIn(BaseModel):
    email: bool | None = None
    push: bool | None = None
    all: bool | None = None


class JourneyStartIn(BaseModel):
    product_code: Annotated[str, Field(max_length=32)]
    communication_id: int | None = None
    source: Literal["web", "miniapp"] = "web"
    adapt: bool | None = None


class JourneyEventIn(BaseModel):
    kind: Literal["view", "recalc", "idle", "hint_close", "hint_action", "form_leave", "submit"]
    screen: Literal["home", "showcase", "calc", "form", "done"] | None = None
    action: Literal["save", "compare", "ask_manager", "send_fd"] | None = None
    meta: dict[str, Any] = {}


@router.get("/home")
async def home(user: Client, db: DB) -> dict:
    data = await cab_svc.home(db, user)
    await db.commit()
    return {**data, "drafts": [app_out(a) for a in data["drafts"]], "applications": [app_out(a) for a in data["applications"]]}


@router.get("/showcase")
async def showcase(user: Client, db: DB, product: Annotated[str | None, Query(max_length=32)] = None) -> dict:
    return await cab_svc.showcase(db, user, product)


@router.post("/offers/{comm_id}/event")
async def offer_event(comm_id: int, body: OfferEventIn, request: Request, user: Client, db: DB) -> dict:
    c = await register_interaction(db, user, comm_id, body.kind, ip=client_ip(request))
    await db.commit()
    return {"id": c.id, "status": c.status.value, "clicks": c.clicks}


@router.get("/consents")
async def get_consents(user: Client, db: DB) -> dict:
    contact = await client_contact(db, user)
    return consent_map(await get_org(db, user, contact.org_id))


@router.put("/consents")
async def put_consents(body: ConsentsIn, request: Request, user: Client, db: DB) -> dict:
    contact = await client_contact(db, user)
    values = {ConsentChannel(k): v for k, v in body.model_dump(exclude_none=True).items()}
    await set_consents(db, user, contact.org_id, values, ip=client_ip(request))
    await db.commit()
    return consent_map(await get_org(db, user, contact.org_id))


@router.post("/journey", status_code=201)
async def journey_start(body: JourneyStartIn, user: Client, db: DB) -> dict:
    js, cfg = await j_svc.start_session(db, user, product_code=body.product_code, communication_id=body.communication_id,
                                        source=body.source, adapt=body.adapt)
    await db.commit()
    return {**j_svc.session_payload(js, True), "config": cfg}


@router.post("/journey/{session_id}/events")
async def journey_event(session_id: int, body: JourneyEventIn, user: Client, db: DB) -> dict:
    out = await j_svc.handle_event(db, user, session_id, kind=body.kind, screen=body.screen, action=body.action, meta=body.meta)
    await db.commit()
    return out
