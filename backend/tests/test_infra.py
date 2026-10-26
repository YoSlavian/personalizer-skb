"""Идемпотентность, миграции Alembic и схема БД."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, func, inspect, select

from app import db as dbmod
from app.models import Application
from tests.conftest import login

BACKEND = Path(__file__).resolve().parent.parent


async def test_idempotency_key_prevents_duplicate_application(client):
    await login(client, "fd@vostok-import.demo")
    body = {"product_code": "factoring", "amount_rub": 25_000_000, "term_months": 6, "source": "miniapp"}
    headers = {"Idempotency-Key": "test-key-0001-abcdef"}
    async with dbmod.session_factory()() as s:
        before = (await s.execute(select(func.count()).select_from(Application))).scalar_one()
    r1 = await client.post("/api/applications", json=body, headers=headers)
    r2 = await client.post("/api/applications", json=body, headers=headers)
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"] and r2.headers.get("idempotent-replayed") == "true"
    async with dbmod.session_factory()() as s:
        after = (await s.execute(select(func.count()).select_from(Application))).scalar_one()
    assert after == before + 1
    bad = await client.post("/api/applications", json=body, headers={"Idempotency-Key": "x"})
    assert bad.status_code == 422


def test_alembic_migrations_build_same_schema_as_models():
    """Миграции с нуля создают ту же схему, что описана в моделях (таблицы и колонки)."""
    import app.models  # noqa: F401
    from app.db import Base

    tmp = Path(tempfile.mkdtemp()) / "migr.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{tmp.as_posix()}"}
    res = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr
    insp = inspect(create_engine(f"sqlite:///{tmp.as_posix()}"))
    tables = set(insp.get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)
    for name, table in Base.metadata.tables.items():
        assert {c["name"] for c in insp.get_columns(name)} == {c.name for c in table.columns}, name
    fks = insp.get_foreign_keys("applications")
    assert {fk["referred_table"] for fk in fks} >= {"organizations", "users", "communications"}
    checks = {c["name"] for c in insp.get_check_constraints("applications")}
    assert any("amount_positive" in (c or "") for c in checks)


def test_hosting_database_urls_become_asyncpg():
    from app.config import asyncpg_url

    neon = "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    assert asyncpg_url(neon) == "postgresql+asyncpg://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?ssl=require"
    assert asyncpg_url("postgres://u:p@h:5432/db") == "postgresql+asyncpg://u:p@h:5432/db"
    assert asyncpg_url("sqlite+aiosqlite:///x.db") == "sqlite+aiosqlite:///x.db"
