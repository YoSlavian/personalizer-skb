"""Проверка прототипа по требованиям финального кейса: вход профиля → выход, ограничения, доступ ролей."""

from sqlalchemy import select

from app import db as dbmod
from app.models import Organization, User
from tests.conftest import login

BASE = {"company": "ООО «Проверка»", "industry": "trade", "role": "fd", "role_source": "crm",
        "structure": "solo", "logins_30d": 4}


async def _sim(c, **over) -> dict:
    r = await c.post("/api/decisions/simulate", json={"profile": {**BASE, **over}})
    assert r.status_code == 200, r.text
    return r.json()["result"]


def _out(res: dict) -> tuple:
    o = res["offer"] or {}
    return (o.get("product_code"), o.get("headline"), o.get("visual"), tuple(ch["code"] for ch in res["channels"]), res["frequency"])


async def test_prototype_input_profile_changes_output(analyst):
    """Кейс, стр. 13: отрасль, роль ЛПР, структура и активность меняют предложение, текст/визуал, канал, частоту."""
    base = await _sim(analyst)
    assert base["offer"]["headline"] and base["offer"]["body"] and base["offer"]["visual"]
    # Агро ФД — тоже оборотка, но «к сезону закупок»; IT — другой продукт
    assert _out(await _sim(analyst, industry="agro", seasonal=True, weeks_to_peak=5))[:2] != _out(base)[:2]
    assert _out(await _sim(analyst, industry="it"))[0] != _out(base)[0]
    assert _out(await _sim(analyst, role="acc"))[:3] != _out(base)[:3]
    group = {"name": "ГК «Проверка»", "entities": [
        {"name": "ООО «А»", "industry": "trade", "share": 60, "balance": "surplus", "head": True},
        {"name": "ООО «Б»", "industry": "log", "share": 40, "balance": "credit"}]}
    # Группа — два уровня: юрлицу меняется адресат (1 получатель на группу), продукт группы — в плане группы
    grp = await _sim(analyst, structure="group", group=group, mixed_balances=True)
    assert grp["recipient"] != base["recipient"] and "1 получатель" in grp["recipient"]
    plan = (await analyst.post("/api/groups/plan/simulate", json={"profile": {**BASE, "structure": "group", "group": group,
                                                                              "mixed_balances": True}})).json()
    assert plan["plan"]["group_products"][0]["code"] == "pool"
    high, low = await _sim(analyst, logins_30d=20), await _sim(analyst, logins_30d=0)
    assert _out(high)[3] != _out(low)[3] and high["frequency"] != low["frequency"]


async def test_as_is_is_shown_next_to_personalized(analyst):
    """«Было / стало»: AS IS не зависит от роли, персонализированный ответ — зависит."""
    owner, acc = await _sim(analyst, role="owner"), await _sim(analyst, role="acc")
    assert owner["as_is"]["product_code"] == acc["as_is"]["product_code"]
    assert owner["offer"]["product_code"] != acc["offer"]["product_code"]


async def test_incomplete_crm_falls_back_to_as_is(analyst):
    """Ограничение: роль ЛПР в CRM может быть не заполнена — без данных движок не выдумывает, а берёт AS IS."""
    res = await _sim(analyst, industry="unk", role_source="none", logins_30d=0)
    assert res["completeness"] < 50 and res["fallback"] is True


async def test_opt_out_and_channel_consents(analyst):
    """Ограничение: отказ от коммуникаций — по каналу и полностью."""
    no_email = await _sim(analyst, logins_30d=20, opt_out_email=True)
    assert "email" not in [ch["code"] for ch in no_email["channels"]]
    assert (await _sim(analyst, opt_out_all=True))["suppressed"] is True


async def test_ved_needs_currency_signal(analyst):
    """Валютное законодательство: ВЭД вне оптовой торговли — только при валютном платеже или участии в ВЭД по ФТС."""
    plain = await _sim(analyst, industry="it")
    ved = next(r for r in plain["rows"] if r["code"] == "ved")
    assert ved["total"] == 0 and ved["excluded_reason"]
    fts = await _sim(analyst, industry="it", foreign_trade=True)
    assert next(r for r in fts["rows"] if r["code"] == "ved")["total"] > 0


async def test_owned_product_is_not_offered_again(analyst):
    res = await _sim(analyst, owned_products=["working"])
    assert next(r for r in res["rows"] if r["code"] == "working")["total"] == 0


async def test_role_access_matrix(client, new_client):
    """Клиенту недоступны данные банка; менеджеру — правила и администрирование; аналитику — администрирование."""
    await login(client, "fd@pole-invest.demo")
    for path in ("/api/orgs", "/api/rules", "/api/admin/users", "/api/tasks", "/api/campaigns"):
        assert (await client.get(path)).status_code == 403, path
    assert (await client.post("/api/decisions/simulate", json={"profile": BASE})).status_code == 403

    await login(new_client, "km.ivanova@demo.local")
    assert (await new_client.get("/api/orgs")).status_code == 200
    assert (await new_client.get("/api/admin/users")).status_code == 403
    assert (await new_client.post("/api/rules", json={"config": {}, "comment": "x"})).status_code == 403
    assert (await new_client.post("/api/campaigns/run", json={"dry_run": True})).status_code == 403

    await login(new_client, "analyst@demo.local")
    assert (await new_client.get("/api/admin/users")).status_code == 403
    assert (await new_client.get("/api/admin/audit")).status_code == 403


async def test_client_cannot_read_other_company_data(client, new_client):
    await login(client, "fd@pole-invest.demo")
    app_id = (await client.post("/api/applications", json={"product_code": "leasing", "amount_rub": 5_000_000,
                                                           "term_months": 24, "source": "miniapp"})).json()["id"]
    await login(new_client, "buh@kod-servis.demo")
    assert (await new_client.get(f"/api/applications/{app_id}")).status_code in (403, 404)
    async with dbmod.session_factory()() as s:
        other = (await s.execute(select(Organization.id).where(Organization.name == "ООО «Поле-Инвест»"))).scalar_one()
    assert (await new_client.get(f"/api/orgs/{other}")).status_code in (403, 404)


async def test_demo_people_are_synthetic():
    """Только синтетика: учётные записи на служебных доменах, без реальных адресов."""
    async with dbmod.session_factory()() as s:
        emails = (await s.execute(select(User.email))).scalars().all()
    assert emails and not [e for e in emails if not e.endswith((".demo", ".local", ".test", ".example"))]
