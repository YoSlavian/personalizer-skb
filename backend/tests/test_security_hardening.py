"""Укрепление после аудита безопасности: IP за прокси, LIKE-поиск, публичное демо."""

from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.api.deps import client_ip
from app.config import get_settings
from app.db import like_pattern
from app.demo_accounts import ensure_not_public_demo
from app.errors import Forbidden


def _req(headers: dict[str, str], peer: str = "10.0.0.1") -> Request:
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()], "client": (peer, 1234)})


def test_client_ip_uses_last_forwarded_hop() -> None:
    # Клиент подставил «1.1.1.1», прокси дописал реальный адрес последним
    assert client_ip(_req({"X-Forwarded-For": "1.1.1.1, 203.0.113.7"})) == "203.0.113.7"
    assert client_ip(_req({})) == "10.0.0.1"


def test_like_pattern_escapes_wildcards() -> None:
    assert like_pattern(" 50%_off\\ ") == "%50\\%\\_off\\\\%"


def test_public_demo_blocks_destructive_actions(monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "demo_mode", True)
    monkeypatch.setattr(s, "environment", "production")
    with pytest.raises(Forbidden):
        ensure_not_public_demo(SimpleNamespace(email="admin@demo.local"))
    ensure_not_public_demo(SimpleNamespace(email="real.admin@bank.example"))
    monkeypatch.setattr(s, "environment", "development")
    ensure_not_public_demo(SimpleNamespace(email="admin@demo.local"))


async def test_public_demo_allows_only_campaign_preview(analyst, monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "demo_mode", True)
    monkeypatch.setattr(s, "environment", "production")
    blocked = await analyst.post("/api/campaigns/run", json={})
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "demo_read_only"
    assert (await analyst.post("/api/campaigns/run", json={"dry_run": True})).status_code == 200


async def test_public_demo_viewer_clicks_do_not_change_shared_offer(fd_client, monkeypatch: pytest.MonkeyPatch) -> None:
    # Учёткой ФД пользуются все зрители: два клика без заявки не должны включать стоп-кран для остальных
    s = get_settings()
    monkeypatch.setattr(s, "demo_mode", True)
    monkeypatch.setattr(s, "environment", "production")
    offer = (await fd_client.get("/api/cabinet/home")).json()["offer"]
    for _ in range(3):
        r = (await fd_client.post(f"/api/cabinet/offers/{offer['communication_id']}/event", json={"kind": "clicked"})).json()
        assert r["demo_local"] is True
    hidden = (await fd_client.post(f"/api/cabinet/offers/{offer['communication_id']}/event", json={"kind": "hidden"})).json()
    assert hidden["demo_local"] is True and hidden["status"] != "hidden"
    after = (await fd_client.get("/api/cabinet/home")).json()["offer"]
    assert after["product_code"] == offer["product_code"]
    blocked = await fd_client.put("/api/cabinet/consents", json={"all": True})
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "demo_read_only"
    assert (await fd_client.get("/api/cabinet/home")).json()["suppressed"] is False


async def test_public_demo_staff_cannot_change_consents(manager, monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "demo_mode", True)
    monkeypatch.setattr(s, "environment", "production")
    org = (await manager.get("/api/orgs?size=1")).json()["items"][0]
    r = await manager.put(f"/api/orgs/{org['id']}/consents", json={"all": True})
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_read_only"
    # Карточка клиента общая для всех зрителей: события и роли контактов в публичном демо не меняем
    r = await manager.post(f"/api/orgs/{org['id']}/signals", json={"kind": "fx_payment", "days": 7})
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_read_only"


async def test_public_demo_viewer_cannot_turn_off_journey_hints(fd_client, monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "demo_mode", True)
    monkeypatch.setattr(s, "environment", "production")
    r = await fd_client.patch("/api/me/settings", json={"adaptive_hints": False})
    assert r.status_code == 403 and r.json()["error"]["code"] == "demo_read_only"
    assert (await fd_client.patch("/api/me/settings", json={"notify_offers": True})).status_code == 200
