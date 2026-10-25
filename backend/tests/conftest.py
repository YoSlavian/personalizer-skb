import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="sp-tests-"))
os.environ.update({
    "ENVIRONMENT": "test",
    "DEMO_MODE": "true",
    "DATABASE_URL": f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}",
    "TELEGRAM_BOT_TOKEN": "123456:TEST-TOKEN-not-real",
    "TELEGRAM_BOT_USERNAME": "personalizer_test_bot",
    "PUBLIC_BASE_URL": "https://miniapp.example.test",
    "SERVE_FRONTEND": "false",
    "RATE_LIMIT_PER_MINUTE": "100000",
})

import json  # noqa: E402
import time  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from app import db as dbmod  # noqa: E402
from app.db import Base  # noqa: E402
from app.demo_accounts import DEMO_PASSWORD  # noqa: E402
from app.main import api_limiter, app  # noqa: E402
from app.security.telegram_auth import sign_init_data  # noqa: E402
from app.services.auth import ip_login_limiter, login_limiter  # noqa: E402

BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


@pytest.fixture(scope="session", autouse=True)
async def database():
    import app.models  # noqa: F401
    from app.seed import seed

    async with dbmod.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with dbmod.session_factory()() as s:
        await seed(s)
    yield
    await dbmod.engine.dispose()


@pytest.fixture(autouse=True)
def _reset_limiters():
    login_limiter.clear()
    ip_login_limiter.clear()
    api_limiter.clear()


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def login(c: httpx.AsyncClient, email: str, password: str = DEMO_PASSWORD) -> dict:
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    data = r.json()
    c.headers["X-CSRF-Token"] = data["csrf_token"]
    return data


@pytest.fixture
async def analyst(client):
    await login(client, "analyst@demo.local")
    return client


@pytest.fixture
async def manager(client):
    await login(client, "km.ivanova@demo.local")
    return client


@pytest.fixture
async def fd_client(client):
    await login(client, "fd@pole-invest.demo")
    return client


@pytest.fixture
async def new_client():
    """Отдельный HTTP-клиент для второй сессии в одном тесте."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


def init_data(tg_id: int, username: str = "tester", *, age: int = 0, start_param: str | None = None) -> str:
    fields = {"auth_date": str(int(time.time()) - age), "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
              "user": json.dumps({"id": tg_id, "first_name": "Тест", "username": username}, ensure_ascii=False, separators=(",", ":"))}
    if start_param:
        fields["start_param"] = start_param
    return sign_init_data(fields, BOT_TOKEN)
