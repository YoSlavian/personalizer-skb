"""Авторизация, CSRF, ограничение частоты, вход Mini App по initData, разграничение доступа."""

from sqlalchemy import select

from app import db as dbmod
from app.models import Application, Organization, TelegramLink, User
from tests.conftest import init_data, login


async def test_login_me_logout(client):
    data = await login(client, "analyst@demo.local")
    assert data["user"]["role"] == "analyst" and "password_hash" not in str(data)
    assert (await client.get("/api/auth/me")).status_code == 200
    assert (await client.post("/api/auth/logout")).status_code == 200
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_wrong_password_and_bruteforce_limit(client):
    for _ in range(5):
        r = await client.post("/api/auth/login", json={"email": "analyst@demo.local", "password": "wrong-password"})
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "invalid_credentials"
    r = await client.post("/api/auth/login", json={"email": "analyst@demo.local", "password": "wrong-password"})
    assert r.status_code == 429 and "Retry-After" in r.headers


async def test_csrf_required_for_cookie_session(client):
    await login(client, "km.ivanova@demo.local")
    token = client.headers.pop("X-CSRF-Token")
    r = await client.post("/api/notifications/read-all")
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    client.headers["X-CSRF-Token"] = token
    assert (await client.post("/api/notifications/read-all")).status_code == 200


async def test_validation_error_format(analyst):
    r = await analyst.post("/api/decisions/simulate", json={"profile": {"industry": "space", "logins_30d": -1}})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "validation_error" and {d["loc"] for d in err["details"]} >= {"industry", "logins_30d"}


async def test_client_cannot_open_staff_sections(fd_client):
    assert (await fd_client.get("/api/orgs")).status_code == 403
    assert (await fd_client.get("/api/tasks")).status_code == 403
    assert (await fd_client.post("/api/campaigns/run", json={"dry_run": True})).status_code == 403


async def test_client_cannot_read_foreign_application_by_id(fd_client):
    async with dbmod.session_factory()() as s:
        kod = (await s.execute(select(Organization).where(Organization.name == "АО «Код-Сервис»"))).scalar_one()
        foreign = (await s.execute(select(Application).where(Application.org_id == kod.id))).scalars().first()
    r = await fd_client.get(f"/api/applications/{foreign.id}")
    assert r.status_code == 404  # не раскрываем факт существования
    r = await fd_client.post(f"/api/applications/{foreign.id}/comments", json={"body": "чужая заявка"})
    assert r.status_code == 404


async def test_manager_sees_only_own_portfolio(client):
    await login(client, "km.petrov@demo.local")
    async with dbmod.session_factory()() as s:
        ivanova = (await s.execute(select(User).where(User.email == "km.ivanova@demo.local"))).scalar_one()
        org = (await s.execute(select(Organization).where(Organization.manager_id == ivanova.id))).scalars().first()
    assert (await client.get(f"/api/orgs/{org.id}")).status_code == 404
    listed = (await client.get("/api/orgs?size=100")).json()["items"]
    assert listed and all(o["manager"]["full_name"] == "Дмитрий Петров" for o in listed)


async def test_miniapp_auth_requires_valid_signature(client):
    tampered = init_data(777001, "tester").replace("tester", "hacker")  # подмена данных пользователя без пересчёта подписи
    r = await client.post("/api/auth/telegram", json={"init_data": tampered})
    assert r.status_code == 401
    r = await client.post("/api/auth/telegram", json={"init_data": init_data(777001, age=3 * 86400)})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_init_data"
    r = await client.post("/api/auth/telegram", json={"init_data": init_data(777001)})
    assert r.status_code == 403 and r.json()["error"]["code"] == "telegram_not_linked"


async def test_miniapp_link_login_then_bearer_session(client, new_client):
    data = init_data(777002, "fd_tester")
    r = await client.post("/api/auth/telegram/link-login", json={"init_data": data, "email": "fd@pole-invest.demo", "password": "Demo-2026!"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    async with dbmod.session_factory()() as s:
        link = (await s.execute(select(TelegramLink).where(TelegramLink.telegram_user_id == 777002))).scalar_one()
        assert link.via == "miniapp"
    # Повторный запуск Mini App: вход по initData без пароля
    r = await new_client.post("/api/auth/telegram", json={"init_data": init_data(777002, "fd_tester")})
    assert r.status_code == 200 and r.json()["user"]["email"] == "fd@pole-invest.demo"
    # Bearer-запросы не требуют CSRF
    r = await new_client.post("/api/notifications/read-all", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


async def test_demo_persona_switch_uses_signed_identity(client):
    r = await client.post("/api/demo/telegram-persona", json={"init_data": init_data(777003), "email": "km.ivanova@demo.local"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "manager"
    r = await client.post("/api/demo/telegram-persona", json={"init_data": "user=%7B%22id%22%3A1%7D&hash=00", "email": "admin@demo.local"})
    assert r.status_code == 401


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] is True
    assert "frame-ancestors" in r.headers["content-security-policy"]
