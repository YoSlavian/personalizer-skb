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
