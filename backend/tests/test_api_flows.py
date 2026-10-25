"""Сквозные сценарии через API: кабинет и путь клиента, заявка → менеджер → статус → уведомление, задачи, кампании."""

from sqlalchemy import func, select

from app import db as dbmod
from app.models import Communication, Notification, Organization, Task, TelegramLink, User
from tests.conftest import login


async def _org_id(name: str) -> int:
    async with dbmod.session_factory()() as s:
        return (await s.execute(select(Organization.id).where(Organization.name == name))).scalar_one()


async def test_cabinet_offer_is_personalized_by_role(client, new_client):
    await login(client, "fd@pole-invest.demo")
    fd = (await client.get("/api/cabinet/home")).json()
    assert fd["role"]["code"] == "fd" and fd["variant"] == "test"
    assert fd["offer"]["product_code"] in ("pool", "working")
    assert "Подобрано по" in fd["offer"]["why"]

    await login(new_client, "buh@kod-servis.demo")
    acc = (await new_client.get("/api/cabinet/home")).json()
    assert acc["role"] == {"code": "acc", "name": "Главный бухгалтер", "source": "inferred"}
    assert acc["offer"]["product_code"] == "digital"  # бухгалтеру — операционный продукт
    assert acc["routing"] and "уходит ЛПР" in acc["routing"]


async def test_offer_hide_excludes_product_next_time(new_client):
    await login(new_client, "buh@kod-servis.demo")
    home = (await new_client.get("/api/cabinet/home")).json()
    comm_id = home["offer"]["communication_id"]
    r = await new_client.post(f"/api/cabinet/offers/{comm_id}/event", json={"kind": "hidden"})
    assert r.status_code == 200 and r.json()["status"] == "hidden"
    again = (await new_client.get("/api/cabinet/home")).json()
    # Бухгалтеру доступны только операционные продукты: после скрытия может не остаться ничего — это корректно
    assert again["offer"] is None or again["offer"]["product_code"] != home["offer"]["product_code"]


async def test_journey_application_manager_status_and_notification(client, new_client):
    await login(client, "fd@pole-invest.demo")
    start = await client.post("/api/cabinet/journey", json={"product_code": "working", "source": "miniapp"})
    assert start.status_code == 201
    sid = start.json()["id"]
    for screen in ("showcase", "calc", "showcase", "calc", "showcase"):
        out = (await client.post(f"/api/cabinet/journey/{sid}/events", json={"kind": "view", "screen": screen})).json()
    assert {"type": "compare_block"} in out["active"]
    await client.post(f"/api/cabinet/journey/{sid}/events", json={"kind": "view", "screen": "calc"})
    for _ in range(3):
        out = (await client.post(f"/api/cabinet/journey/{sid}/events", json={"kind": "recalc", "meta": {"amount_rub": 30_000_000, "term_months": 12}})).json()
    assert any(a["type"] == "hint_sheet" for a in out["active"])
    out = (await client.post(f"/api/cabinet/journey/{sid}/events",
                             json={"kind": "hint_action", "action": "ask_manager", "meta": {"amount_rub": 30_000_000, "term_months": 12}})).json()
    assert out["task_id"] and "Менеджер" in out["message"]

    r = await client.post("/api/applications", json={"product_code": "working", "amount_rub": 30_000_000, "term_months": 12,
                                                     "source": "miniapp", "journey_session_id": sid})
    assert r.status_code == 201, r.text
    app = r.json()
    assert app["status"] == "submitted" and app["number"].startswith("З-") and app["assignee"]["full_name"] == "Ольга Иванова"

    await login(new_client, "km.ivanova@demo.local")
    tasks = (await new_client.get("/api/tasks?assignee=me&size=100")).json()["items"]
    assert any(t["application_id"] == app["id"] for t in tasks)
    bad = await new_client.post(f"/api/applications/{app['id']}/status", json={"status": "approved"})
    assert bad.status_code == 422  # из «Отправлена» сразу в «Одобрена» нельзя
    assert (await new_client.post(f"/api/applications/{app['id']}/status", json={"status": "in_review"})).status_code == 200
    r = await new_client.post(f"/api/applications/{app['id']}/status", json={"status": "declined"})
    assert r.status_code == 422  # отказ без комментария
    await new_client.post(f"/api/applications/{app['id']}/comments", json={"body": "Внутренняя заметка", "internal": True})
    r = await new_client.post(f"/api/applications/{app['id']}/status", json={"status": "approved", "comment": "Лимит одобрен"})
    detail = r.json()
    assert detail["status"] == "approved" and [h["to_status"] for h in detail["history"]] == ["submitted", "in_review", "approved"]
    dup = await new_client.post(f"/api/applications/{app['id']}/status", json={"status": "approved"})
    assert dup.status_code == 409

    client_view = (await client.get(f"/api/applications/{app['id']}")).json()
    assert all(not c["internal"] for c in client_view["comments"])
    notes = (await client.get("/api/notifications?unread=true")).json()["items"]
    assert any(app["number"] in n["title"] and "Одобрена" in n["title"] for n in notes)


async def test_task_take_twice_and_done(manager):
    tasks = (await manager.get("/api/tasks?assignee=me&status=open&size=100")).json()["items"]
    t = next(x for x in tasks if x["kind"] != "update_crm_role")
    assert (await manager.post(f"/api/tasks/{t['id']}/status", json={"status": "in_progress"})).status_code == 200
    again = await manager.post(f"/api/tasks/{t['id']}/status", json={"status": "in_progress"})
    assert again.status_code == 409
    r = await manager.post(f"/api/tasks/{t['id']}/status", json={"status": "done", "comment": "Связались с клиентом"})
    assert r.json()["status"] == "done" and r.json()["result"] == "Связались с клиентом"


async def test_crm_role_update_closes_role_task(manager):
    org_id = await _org_id("ООО «Транс-Линия»")
    detail = (await manager.get(f"/api/orgs/{org_id}")).json()
    assert detail["role_source"] == "none"
    contact = detail["contacts"][0]
    r = await manager.patch(f"/api/orgs/{org_id}/contacts/{contact['id']}", json={"crm_position": "owner"})
    assert r.json()["role_source"] == "crm"
    async with dbmod.session_factory()() as s:
        t = (await s.execute(select(Task).where(Task.org_id == org_id, Task.kind == "update_crm_role"))).scalar_one()
        assert t.status.value == "done"


async def test_preview_what_if_changes_offer_without_saving(analyst):
    org_id = await _org_id("ТД «Восток-Импорт»")
    cur = (await analyst.get(f"/api/orgs/{org_id}/decision")).json()
    assert cur["result"]["offer"]["product_code"] == "ved"
    what_if = (await analyst.post(f"/api/orgs/{org_id}/decision/preview", json={"overrides": {"fx_payment": False}})).json()
    assert what_if["result"]["offer"]["product_code"] != "ved"
    again = (await analyst.get(f"/api/orgs/{org_id}/decision")).json()
    assert again["result"]["offer"]["product_code"] == "ved"


async def test_campaign_delivers_then_frequency_blocks_and_push_goes_to_telegram(analyst):
    async with dbmod.session_factory()() as s:
        fd = (await s.execute(select(User).where(User.email == "fd@pole-invest.demo"))).scalar_one()
        if not (await s.execute(select(TelegramLink).where(TelegramLink.user_id == fd.id))).scalar_one_or_none():
            s.add(TelegramLink(user_id=fd.id, telegram_user_id=888001, chat_id=888001, username="fd"))
            await s.commit()
        # push уходит только при высокой активности: поднимем активность ЛПР агрохолдинга
        pole = (await s.execute(select(Organization).where(Organization.name == "ООО «Поле-Инвест»"))).scalar_one()
        pole.logins_30d = 20
        await s.commit()
    dry = (await analyst.post("/api/campaigns/run", json={"dry_run": True})).json()
    assert dry["dry_run"] and "id" not in dry
    first = (await analyst.post("/api/campaigns/run", json={})).json()
    assert first["sent_total"] > 0 and first["variants"]["control"] > 0
    second = (await analyst.post("/api/campaigns/run", json={})).json()
    assert second["blocked_total"] >= first["sent_total"] * 0.5
    assert any("Лимит" in k or "КМ" in k for k in second["blocked_by_reason"])
    async with dbmod.session_factory()() as s:
        pole_id = (await s.execute(select(Organization.id).where(Organization.name == "ООО «Поле-Инвест»"))).scalar_one()
        push = (await s.execute(select(Communication).where(Communication.org_id == pole_id, Communication.channel == "push",
                                                            Communication.campaign_run_id == first["id"]))).scalar_one()
        n = (await s.execute(select(Notification).where(Notification.entity_type == "communication", Notification.entity_id == push.id))).scalars().all()
        assert n and n[0].user_id == fd.id and n[0].tg_status == "pending"
        # Контроль AS IS: каждому юрлицу группы отдельный баннер
        control = (await s.execute(select(func.count()).where(Communication.campaign_run_id == first["id"], Communication.variant == "control"))).scalar_one()
        assert control >= first["variants"]["control"]


async def test_opt_out_all_suppresses_offer(new_client):
    await login(new_client, "fd@vostok-import.demo")
    assert (await new_client.get("/api/cabinet/home")).json()["offer"] is not None
    r = await new_client.put("/api/cabinet/consents", json={"all": True})
    assert r.json()["all"] is True
    home = (await new_client.get("/api/cabinet/home")).json()
    assert home["offer"] is None and home["suppressed"] is True
    await new_client.put("/api/cabinet/consents", json={"all": False})


async def test_rules_versioning(analyst):
    rules = (await analyst.get("/api/rules")).json()
    cfg = rules["active"]["config"]
    cfg["momentum"]["season_window_k"] = 1.5
    r = await analyst.post("/api/rules", json={"config": cfg, "comment": "Калибровка сезонного окна", "activate": True})
    assert r.status_code == 201 and r.json()["is_active"]
    bad = dict(cfg)
    bad["completeness_threshold"] = 500
    r = await analyst.post("/api/rules", json={"config": bad, "comment": "Ошибка", "activate": True})
    assert r.status_code == 422
    await analyst.post(f"/api/rules/{rules['active']['version']}/activate")


async def test_analytics_and_dashboard(analyst):
    r = await analyst.get("/api/analytics/overview?days=90")
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["variants"]["test"]["shown"] > 0 and a["variants"]["control"]["shown"] > 0
    assert set(a["journey"]) == {"adaptive", "static"} and "disclaimer" in a
    d = (await analyst.get("/api/dashboard")).json()
    assert "kpi" in d and isinstance(d["tasks"], list)


async def test_pagination_filters_and_search(analyst):
    p1 = (await analyst.get("/api/orgs?size=10&page=1&sort=name")).json()
    p2 = (await analyst.get("/api/orgs?size=10&page=2&sort=name")).json()
    assert p1["total"] == p2["total"] >= 40 and {o["id"] for o in p1["items"]}.isdisjoint({o["id"] for o in p2["items"]})
    agro = (await analyst.get("/api/orgs?segment=S2&size=100")).json()["items"]
    assert agro and all(o["seasonal"] for o in agro)
    found = (await analyst.get("/api/orgs?search=Поле")).json()["items"]
    assert {o["name"] for o in found} >= {"ООО «Поле-Инвест»", "ООО «Поле-Транс»"}
