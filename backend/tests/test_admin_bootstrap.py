"""Личный администратор из переменных окружения."""

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app import db as dbmod
from app.config import get_settings
from app.models import User
from app.models.enums import UserRole
from app.security.passwords import verify_password
from app.services.users import ensure_bootstrap_admin


@pytest.mark.asyncio
async def test_bootstrap_admin_created_and_password_rotated(monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "admin_email", "Owner@Team13.example")
    monkeypatch.setattr(s, "admin_password", SecretStr("Very-strong-pass-2026"))
    async with dbmod.session_factory()() as session:
        assert await ensure_bootstrap_admin(session) is None
        u = (await session.execute(select(User).where(User.email == "owner@team13.example"))).scalar_one()
        assert u.role == UserRole.admin and verify_password("Very-strong-pass-2026", u.password_hash)
    monkeypatch.setattr(s, "admin_password", SecretStr("Another-strong-pass-77"))
    async with dbmod.session_factory()() as session:
        assert await ensure_bootstrap_admin(session) is None
        u = (await session.execute(select(User).where(User.email == "owner@team13.example"))).scalar_one()
        assert verify_password("Another-strong-pass-77", u.password_hash)


@pytest.mark.asyncio
async def test_bootstrap_admin_rejects_weak_password(monkeypatch: pytest.MonkeyPatch) -> None:
    s = get_settings()
    monkeypatch.setattr(s, "admin_email", "weak@team13.example")
    monkeypatch.setattr(s, "admin_password", SecretStr("short1"))
    async with dbmod.session_factory()() as session:
        assert await ensure_bootstrap_admin(session) is not None
