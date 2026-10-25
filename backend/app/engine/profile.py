"""Вход и выход движка. Профиль собирается сервисом из БД или задаётся вручную в симуляторе."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.engine.catalog import PRODUCTS

IndustryCode = Literal["agro", "retail", "it", "log", "trade", "mfg", "unk"]
RoleCode = Literal["owner", "fd", "acc", "ops"]
RoleSource = Literal["crm", "inferred", "none"]
BalanceCode = Literal["credit", "surplus"]


class GroupEntity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)]
    industry: IndustryCode
    share: Annotated[int, Field(ge=0, le=100)]
    balance: BalanceCode
    org_id: int | None = None
    head: bool = False


class GroupInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, Field(min_length=1, max_length=200)]
    entities: Annotated[list[GroupEntity], Field(min_length=1, max_length=20)]


class ClientProfile(BaseModel):
    """Признаки клиента: кому (роль, структура), что и когда (отрасль, сезон, события), как (активность, отказы)."""

    model_config = ConfigDict(extra="forbid")

    company: Annotated[str, Field(min_length=1, max_length=200)] = "Компания"
    industry: IndustryCode = "unk"
    seasonal: bool = False
    weeks_to_peak: Annotated[int, Field(ge=0, le=52)] = 6
    role: RoleCode = "fd"
    role_source: RoleSource = "crm"
    structure: Literal["solo", "group"] = "solo"
    size: Literal["mid", "large"] = "mid"
    group: GroupInfo | None = None
    mixed_balances: bool = False
    logins_30d: Annotated[int, Field(ge=0, le=1000)] = 4
    fx_payment: bool = False
    deposit_ending: bool = False
    bki_request: bool = False
    hidden_products: list[str] = []
    stopped_products: list[str] = []
    opt_out_email: bool = False
    opt_out_push: bool = False
    opt_out_all: bool = False
    turnover_by_month: Annotated[list[float], Field(min_length=12, max_length=12)] | None = None

    @field_validator("hidden_products", "stopped_products")
    @classmethod
    def _known(cls, v: list[str]) -> list[str]:
        unknown = [p for p in v if p not in PRODUCTS]
        if unknown:
            raise ValueError(f"Неизвестные продукты: {unknown}")
        return sorted(set(v))

    @property
    def effective_role(self) -> str | None:
        return None if self.role_source == "none" else self.role


class ScoreRow(BaseModel):
    code: str
    name: str
    base: float
    k_industry: float
    k_moment: float
    k_role: float
    k_structure: float
    k_source: float
    total: float
    excluded_reason: str | None = None
    why: list[str] = []


class ChannelOut(BaseModel):
    code: str
    label: str


class Offer(BaseModel):
    product_code: str
    product_name: str
    headline: str
    body: str
    cta: str
    visual: str


class Action(BaseModel):
    """Структурированное следующее действие (NBA), которое исполняет сервис."""

    type: Literal["show_offer", "km_task", "nothing"]
    kind: str | None = None
    title: str | None = None
    priority: Literal["low", "normal", "high"] = "normal"
    due_hours: int | None = None


class AsIs(BaseModel):
    product_code: str
    product_name: str
    headline: str
    who: str
    channel: str
    channel_code: str
    frequency: str
    group: str


class DecisionResult(BaseModel):
    company: str
    completeness: int
    fallback: bool
    suppressed: bool
    activity_level: Literal["high", "mid", "low"]
    role: str | None
    role_name: str | None
    winner: ScoreRow | None
    offer: Offer | None
    recipient: str
    channels: list[ChannelOut]
    frequency: str
    nba: str
    actions: list[Action]
    routing: str | None
    event_note: str | None
    notes: list[str]
    rows: list[ScoreRow]
    as_is: AsIs
    segments: list[str]
    visual_data: dict
