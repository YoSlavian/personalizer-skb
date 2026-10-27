"""Движок персонализации: паритет с прототипом команды, бизнес-правила, холдинг, политика частоты, триггеры пути."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.engine import ClientProfile, decide, default_rules, plan_group
from app.engine.journey import JourneyState, active_adaptations, apply_event
from app.engine.policy import HistoryItem, frequency_block, hidden_products, stopped_products

CFG = default_rules()
GROUPS = {
    "agro": {"name": "Группа «Поле-Инвест»", "entities": [
        {"name": "ООО «Поле-Инвест» (головная)", "industry": "agro", "share": 62, "balance": "credit"},
        {"name": "ООО «Поле-Транс»", "industry": "log", "share": 28, "balance": "surplus"},
        {"name": "ООО «Поле-Маркет»", "industry": "retail", "share": 10, "balance": "surplus"}]},
    "div": {"name": "Группа «Вектор»", "entities": [
        {"name": "АО «Вектор Софт» (головная)", "industry": "it", "share": 40, "balance": "surplus"},
        {"name": "ООО «Вектор Ритейл»", "industry": "retail", "share": 35, "balance": "credit"},
        {"name": "ООО «Вектор Завод»", "industry": "mfg", "share": 25, "balance": "credit"}]},
}


def proto_profile(s: dict) -> ClientProfile:
    return ClientProfile(
        company=s["company"], industry=s["industry"], seasonal=s["seasonal"], weeks_to_peak=s["peak"], role=s["role"],
        role_source={"crm": "crm", "inf": "inferred", "none": "none"}[s["rsrc"]], structure=s["struct"], size=s["size"],
        group=GROUPS[s["gpreset"]] if s["struct"] == "group" else None, mixed_balances=s["mixed"], logins_30d=s["act"],
        fx_payment=s["fx"], deposit_ending=s["dep"], bki_request=s["bki"], hidden_products=["working"] if s["hid"] else [],
        opt_out_email=s["noemail"], opt_out_push=s["nopush"], opt_out_all=s["noall"],
    )


def test_parity_with_team_prototype():
    """Результаты Python-движка совпадают с JS-прототипом команды (index.html) на 421 профиле."""
    cases = json.loads((Path(__file__).parent / "fixtures" / "prototype_parity.json").read_text(encoding="utf-8"))
    assert len(cases) > 400
    for c in cases:
        s = c["s"]
        r = decide(proto_profile(s), CFG)
        rows = {x.code: x for x in r.rows}
        for code, total, off in c["rows"]:
            assert rows[code].total == pytest.approx(total, abs=1e-5), (s, code)
            assert (rows[code].excluded_reason or None) == (off or None), (s, code)
        assert r.completeness == c["comp"]
        assert r.routing == c["routing"]
        assert r.recipient == c["who"]
        if not s["noall"] and not r.fallback:
            assert (r.winner.code if r.winner else None) == c["win"]
            assert [ch.label for ch in r.channels] == c["channels"]
            assert r.frequency == c["freq"]
            assert r.nba == (c["nba"] or "Показать предложение")
            if c["txt"] and r.offer:
                assert [r.offer.headline, r.offer.body, r.offer.cta] == c["txt"]


def base(**kw) -> ClientProfile:
    d = dict(company="Тест", industry="agro", seasonal=True, weeks_to_peak=5, role="fd", role_source="crm", logins_30d=4)
    d.update(kw)
    return ClientProfile(**d)


def test_change_profile_changes_result():
    """Критерий кейса: изменение профиля меняет продукт, текст, канал и частоту."""
    a = decide(base(), CFG)
    b = decide(base(industry="it", seasonal=False, role="acc", role_source="inferred", logins_30d=22), CFG)
    assert a.offer.product_code == "working" and "сезону" in a.offer.headline
    assert b.offer.product_code == "digital"
    assert [c.code for c in a.channels] == ["email", "boss"]
    assert [c.code for c in b.channels] == ["banner_ib", "push"]
    assert a.frequency != b.frequency
    assert b.routing and "уходит ЛПР" in b.routing


def test_season_window_boosts_working_capital():
    in_window = {x.code: x for x in decide(base(weeks_to_peak=5), CFG).rows}["working"]
    off_window = {x.code: x for x in decide(base(weeks_to_peak=12), CFG).rows}["working"]
    assert in_window.k_moment == 1.3 and off_window.k_moment == 0.8
    assert "окно 4–6 недель до пика" in in_window.why


def test_opt_out_all_means_do_nothing():
    r = decide(base(opt_out_all=True), CFG)
    assert r.suppressed and r.channels == [] and r.offer is None
    assert r.actions[0].type == "nothing"


def test_channel_opt_out_filters_channel():
    r = decide(base(logins_30d=20, opt_out_push=True), CFG)
    assert "push" not in [c.code for c in r.channels]


def test_unknown_role_and_industry_fallback_to_as_is_with_crm_task():
    r = decide(base(industry="unk", seasonal=False, role_source="none"), CFG)
    assert r.fallback and r.completeness < 50
    assert r.offer.product_code == r.as_is.product_code
    assert any(a.kind == "update_crm_role" for a in r.actions)


def test_fx_event_takes_contextual_placement():
    r = decide(base(industry="trade", seasonal=False, fx_payment=True, logins_30d=12), CFG)
    assert r.offer.product_code == "ved" and r.event_note
    assert [c.code for c in r.channels] == ["fx_placement"]


def test_bki_request_creates_call_task():
    r = decide(base(bki_request=True), CFG)
    call = [a for a in r.actions if a.kind == "call_48h"]
    assert call and call[0].due_hours == 48 and call[0].priority == "high"


def test_hidden_and_stopped_products_excluded():
    r = decide(base(hidden_products=["working"], stopped_products=["concession"]), CFG)
    rows = {x.code: x for x in r.rows}
    assert rows["working"].total == 0 and "скрыл баннер" in rows["working"].excluded_reason
    assert rows["concession"].total == 0 and "стоп-кран" in rows["concession"].excluded_reason
    assert r.offer.product_code not in ("working", "concession")


def test_group_mixed_balances_prefers_cash_pooling_plan():
    p = base(structure="group", group=GROUPS["agro"], mixed_balances=True)
    plan = plan_group(p, CFG)
    assert plan.main_industry.industry == "agro" and plan.main_industry.share == 62
    assert plan.group_products[0].code == "pool"
    products = [i.product_code for i in plan.plan]
    assert len(products) == len(set(products)) <= 4
    assert all(o.product_code != "deposit" for o in plan.entity_offers if o.balance == "surplus")


def test_diversified_group_has_no_main_industry():
    plan = plan_group(base(structure="group", group=GROUPS["div"]), CFG)
    assert plan.main_industry.diversified and plan.main_industry.industry is None


NOW = datetime(2026, 10, 25, 12, tzinfo=UTC)


def h(channel: str, days: float, product: str = "working", status: str = "sent", **kw) -> HistoryItem:
    return HistoryItem(channel=channel, product_code=product, status=status, created_at=NOW - timedelta(days=days), **kw)


def test_frequency_limits():
    args = dict(product_code="working", event_driven=False, group_history=None, now=NOW, cfg=CFG)
    assert frequency_block(channel="push", activity_level="high", org_history=[h("boss", 3)], **args)
    assert frequency_block(channel="push", activity_level="high", org_history=[h("boss", 8)], **args) is None
    assert frequency_block(channel="email", activity_level="mid", org_history=[h("email", 10)], **args)
    assert frequency_block(channel="email", activity_level="low", org_history=[h("email", 40)], **args)
    assert frequency_block(channel="km_call", activity_level="low", org_history=[h("km_call", 20)], **args)
    assert frequency_block(channel="email", activity_level="mid", org_history=[h("email", 3, status="blocked")], **args) is None
    # Email — не чаще раза в 60 дней при любой активности, не только у малоактивных
    assert frequency_block(channel="email", activity_level="mid", org_history=[h("email", 40)], **args)
    assert frequency_block(channel="email", activity_level="high", org_history=[h("email", 40)], **args)
    assert frequency_block(channel="email", activity_level="mid", org_history=[h("email", 61)], **args) is None


def test_group_limit_and_event_bypass():
    assert frequency_block(channel="boss", product_code="pool", activity_level="high", event_driven=False, org_history=[],
                           group_history=[h("banner_ib", 2)], now=NOW, cfg=CFG)
    assert frequency_block(channel="fx_placement", product_code="ved", activity_level="mid", event_driven=True, org_history=[h("email", 1)],
                           group_history=None, now=NOW, cfg=CFG) is None
    assert frequency_block(channel="fx_placement", product_code="ved", activity_level="mid", event_driven=True,
                           org_history=[h("fx_placement", 5, product="ved")], group_history=None, now=NOW, cfg=CFG)


def test_stop_crane_and_hidden_from_history():
    hist = [h("boss", 3, clicks=1, clicked_at=NOW - timedelta(days=3)), h("push", 2, clicks=1, clicked_at=NOW - timedelta(days=2)),
            h("boss", 5, product="leasing", hidden_at=NOW - timedelta(days=5))]
    assert stopped_products(hist, NOW, CFG) == ["working"]
    assert hidden_products(hist, NOW, CFG) == ["leasing"]
    hist.append(h("boss", 1, converted_at=NOW - timedelta(days=1)))
    assert stopped_products(hist, NOW, CFG) == []


def run(st: JourneyState, kind: str, t: int, *, screen=None, action=None, last=None, lpr=True, adapt=True):
    start = NOW
    return apply_event(st, kind=kind, screen=screen, action=action, now=start + timedelta(seconds=t), started_at=start,
                       last_event_at=start + timedelta(seconds=last if last is not None else t), adapt=adapt, role_lpr=lpr, cfg=CFG, idle_seconds=8)


def test_journey_quick_client_gets_one_step_apply():
    st = JourneyState()
    run(st, "view", 2, screen="showcase")
    run(st, "view", 5, screen="calc")
    res = run(st, "recalc", 7)
    assert {"type": "quick_apply"} in res.new
    assert {"type": "quick_apply"} in active_adaptations(st, True, True)


def test_journey_returns_show_compare_and_hint_once():
    st = JourneyState()
    for t in (20, 40):
        run(st, "view", t, screen="calc")
        run(st, "view", t + 5, screen="showcase")
    assert st.returns == 2 and st.compare_given
    run(st, "view", 60, screen="calc")
    for t in (61, 62, 63):
        res = run(st, "recalc", t)
    assert res.new and res.new[0]["type"] == "hint_sheet" and res.new[0]["variant"] == "ask_manager"
    run(st, "hint_close", 64)
    res = run(st, "recalc", 65)
    assert res.new == [] and st.hints_closed == 1


def test_journey_accountant_gets_send_to_fd_and_idle_needs_real_pause():
    st = JourneyState()
    run(st, "view", 30, screen="calc")
    assert run(st, "idle", 31, last=30, lpr=False).new == []  # клиент прислал idle слишком рано
    res = run(st, "idle", 45, last=30, lpr=False)
    assert res.new[0]["variant"] == "send_to_fd"


def test_journey_without_adaptation_shows_nothing_and_draft_on_leave():
    st = JourneyState()
    run(st, "view", 1, screen="form", adapt=False)
    res = run(st, "view", 3, screen="home", adapt=False)
    assert "save_draft" in res.side_effects and active_adaptations(st, False, True) == []
    assert {"type": "draft_resume"} in active_adaptations(st, True, True)


def test_rules_validation_rejects_bad_config():
    from pydantic import ValidationError

    from app.engine.rules import DEFAULT_RULES, RulesConfig

    bad = json.loads(json.dumps(DEFAULT_RULES))
    bad["industry_k"]["agro"]["working"] = 9
    with pytest.raises(ValidationError):
        RulesConfig.model_validate(bad)
    bad = json.loads(json.dumps(DEFAULT_RULES))
    bad["products"].pop("ved")
    with pytest.raises(ValidationError):
        RulesConfig.model_validate(bad)
