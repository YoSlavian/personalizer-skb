"""Конфигурация бизнес-правил. Стартовые коэффициенты из прототипа команды; калибруются на пилоте."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.engine.catalog import INDUSTRIES, PRODUCTS, ROLES

Coef = Annotated[float, Field(ge=0, le=5)]


class ProductBase(BaseModel):
    """AS IS-вход оптимизатора: склонность (синтетика mock-модели) и вес дохода."""

    model_config = ConfigDict(extra="forbid")
    p: Annotated[float, Field(ge=0, le=1)]
    rev: Annotated[float, Field(ge=0, le=5)]


class Momentum(BaseModel):
    model_config = ConfigDict(extra="forbid")
    season_window_min: Annotated[int, Field(ge=0, le=26)] = 4
    season_window_max: Annotated[int, Field(ge=0, le=26)] = 6
    season_window_k: Coef = 1.3
    season_near_k: Coef = 1.1
    season_off_k: Coef = 0.8
    fx_k: Coef = 1.5
    deposit_k: Coef = 1.5
    bki_k: Coef = 1.4

    @model_validator(mode="after")
    def _window(self) -> "Momentum":
        if self.season_window_min > self.season_window_max:
            raise ValueError("season_window_min не может быть больше season_window_max")
        return self


class Structure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pool_mixed_k: Coef = 1.6
    pool_k: Coef = 1.2
    group_k: Coef = 1.2


class RoleSourceWeight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    crm: Coef = 1.0
    inferred: Coef = 0.9
    none: Coef = 0.85


class Activity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    high_min: Annotated[int, Field(ge=1, le=100)] = 8
    mid_min: Annotated[int, Field(ge=1, le=100)] = 2

    @model_validator(mode="after")
    def _order(self) -> "Activity":
        if self.mid_min >= self.high_min:
            raise ValueError("Порог средней активности должен быть ниже порога высокой")
        return self


class Frequency(BaseModel):
    """Минимальный интервал между маркетинговыми коммуникациями, дней."""

    model_config = ConfigDict(extra="forbid")
    high: Annotated[int, Field(ge=1, le=365)] = 7
    mid: Annotated[int, Field(ge=1, le=365)] = 14
    low_email: Annotated[int, Field(ge=1, le=365)] = 60
    low_km: Annotated[int, Field(ge=1, le=365)] = 30
    group: Annotated[int, Field(ge=1, le=365)] = 7
    fx_repeat: Annotated[int, Field(ge=1, le=365)] = 30


class StopCrane(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clicks: Annotated[int, Field(ge=1, le=20)] = 2
    days: Annotated[int, Field(ge=1, le=180)] = 14


class Journey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    returns_threshold: Annotated[int, Field(ge=1, le=20)] = 2
    recalc_threshold: Annotated[int, Field(ge=1, le=20)] = 3
    idle_seconds: Annotated[int, Field(ge=3, le=600)] = 45
    quick_seconds: Annotated[int, Field(ge=1, le=600)] = 15
    max_hints: Annotated[int, Field(ge=0, le=5)] = 1


class RulesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    products: dict[str, ProductBase]
    industry_k: dict[str, dict[str, Coef]]
    role_k: dict[str, dict[str, Coef]]
    momentum: Momentum = Momentum()
    structure: Structure = Structure()
    role_source_weight: RoleSourceWeight = RoleSourceWeight()
    completeness_threshold: Annotated[int, Field(ge=0, le=100)] = 50
    activity: Activity = Activity()
    frequency: Frequency = Frequency()
    stop_crane: StopCrane = StopCrane()
    hidden_pause_days: Annotated[int, Field(ge=1, le=365)] = 30
    large_meeting_score: Annotated[float, Field(ge=0, le=5)] = 0.2
    journey: Journey = Journey()

    @model_validator(mode="after")
    def _known_keys(self) -> "RulesConfig":
        unknown_products = set(self.products) - set(PRODUCTS)
        missing_products = set(PRODUCTS) - set(self.products)
        if unknown_products or missing_products:
            raise ValueError(f"Продукты должны совпадать со справочником: лишние {sorted(unknown_products)}, нет {sorted(missing_products)}")
        for ind, row in self.industry_k.items():
            if ind not in INDUSTRIES:
                raise ValueError(f"Неизвестная отрасль: {ind}")
            if set(row) - set(PRODUCTS):
                raise ValueError(f"Неизвестный продукт в отрасли {ind}: {sorted(set(row) - set(PRODUCTS))}")
        for role, row in self.role_k.items():
            if role not in ROLES:
                raise ValueError(f"Неизвестная роль: {role}")
            if set(row) - set(PRODUCTS):
                raise ValueError(f"Неизвестный продукт у роли {role}: {sorted(set(row) - set(PRODUCTS))}")
        return self


DEFAULT_RULES: dict = {
    "products": {
        "working": {"p": 0.22, "rev": 1.0},
        "concession": {"p": 0.14, "rev": 0.8},
        "project": {"p": 0.10, "rev": 1.3},
        "leasing": {"p": 0.16, "rev": 0.9},
        "factoring": {"p": 0.14, "rev": 0.8},
        "ved": {"p": 0.10, "rev": 0.7},
        "deposit": {"p": 0.20, "rev": 0.6},
        "digital": {"p": 0.15, "rev": 0.3},
        "pool": {"p": 0.10, "rev": 0.8},
        "glimit": {"p": 0.08, "rev": 1.1},
        "syndic": {"p": 0.05, "rev": 1.5},
    },
    # Матрица «отрасль × продукт»: 1.2 — релевантно, 1.0 — нейтрально. Калибруется по заявкам по ОКВЭД.
    "industry_k": {
        "agro": {"working": 1.2, "concession": 1.2, "leasing": 1.1},
        "retail": {"working": 1.2, "factoring": 1.1},
        "it": {"deposit": 1.3, "digital": 1.2, "working": 0.7, "leasing": 0.7},
        "log": {"leasing": 1.4, "working": 1.1},
        "trade": {"ved": 1.2, "factoring": 1.2},
        "mfg": {"project": 1.3, "leasing": 1.2},
        "unk": {},
    },
    "role_k": {
        "owner": {"project": 1.3, "leasing": 1.3, "syndic": 1.2, "concession": 1.1},
        "fd": {"deposit": 1.2, "working": 1.1, "pool": 1.2, "glimit": 1.2, "factoring": 1.1},
        "acc": {"digital": 1.3, "ved": 1.1},
        "ops": {"digital": 1.1, "ved": 1.2},
    },
}


def default_rules() -> RulesConfig:
    return RulesConfig.model_validate(DEFAULT_RULES)
