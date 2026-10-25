"""Адаптер текущего ML-оптимизатора (AS IS): склонность к продукту и вес дохода.

Контракт HTTP-адаптера (если банк предоставит API):
    POST {OPTIMIZER_API_URL}/v1/propensity
    {"client_ref": "<синтетический id>", "products": ["working", ...]}
    → 200 {"scores": {"working": {"p": 0.22, "rev": 1.0}, ...}}
Пока API нет, используется MockPropensityAdapter: стартовые синтетические значения из версии правил.
Ошибка или тайм-аут внешнего вызова не ломает решение — используется mock с записью в лог.
"""

import os
from typing import Protocol

import httpx

from app.engine.catalog import PRODUCTS
from app.engine.rules import RulesConfig
from app.integrations.base import IntegrationError, log, with_retry


class PropensityAdapter(Protocol):
    name: str

    async def scores(self, client_ref: str, cfg: RulesConfig) -> dict[str, tuple[float, float]] | None: ...


class MockPropensityAdapter:
    """MOCK: возвращает None — движок берёт синтетические p и rev из активной версии правил."""

    name = "mock"

    async def scores(self, client_ref: str, cfg: RulesConfig) -> dict[str, tuple[float, float]] | None:
        return None


class HttpPropensityAdapter:
    name = "http"

    def __init__(self, base_url: str, token: str | None, timeout: float = 3.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    async def scores(self, client_ref: str, cfg: RulesConfig) -> dict[str, tuple[float, float]] | None:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

        async def call() -> dict:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(f"{self.base_url}/v1/propensity", json={"client_ref": client_ref, "products": list(PRODUCTS)}, headers=headers)
                r.raise_for_status()
                return r.json()

        try:
            data = await with_retry("optimizer", call, attempts=2, timeout=self.timeout + 1, retry_on=(httpx.HTTPError,))
            raw = data.get("scores", {})
            return {code: (float(v["p"]), float(v["rev"])) for code, v in raw.items() if code in PRODUCTS}
        except (IntegrationError, KeyError, TypeError, ValueError) as e:
            log.warning("optimizer: используем mock, внешний вызов не удался: %s", type(e).__name__)
            return None


def apply_scores(cfg: RulesConfig, scores: dict[str, tuple[float, float]] | None) -> RulesConfig:
    if not scores:
        return cfg
    data = cfg.model_dump()
    for code, (p, rev) in scores.items():
        data["products"][code] = {"p": p, "rev": rev}
    return RulesConfig.model_validate(data)


def get_adapter() -> PropensityAdapter:
    url = os.getenv("OPTIMIZER_API_URL")
    if url:
        return HttpPropensityAdapter(url, os.getenv("OPTIMIZER_API_TOKEN"))
    return MockPropensityAdapter()
