"""Синтетические демо-данные. Только для тестового режима: реальных клиентов, ФИО и реквизитов здесь нет.

Запуск: python -m app.seed            — заполнить пустую БД
        python -m app.seed --reset    — очистить и заполнить заново (запрещено при ENVIRONMENT=production)
"""

import argparse
import asyncio
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import db as dbmod
from app.config import get_settings
from app.db import Base, utcnow
from app.demo_accounts import DEMO_PASSWORD
from app.engine.catalog import PRODUCTS
from app.engine.rules import DEFAULT_RULES, RulesConfig
from app.models import (
    Application,
    ApplicationComment,
    Communication,
    CompanyGroup,
    Consent,
    Contact,
    JourneyEvent,
    JourneySession,
    Notification,
    Organization,
    RuleSet,
    Signal,
    StatusChange,
    Task,
    User,
    UserSettings,
)
from app.models.enums import (
    AbVariant,
    AppSource,
    AppStatus,
    BalanceKind,
    Channel,
    CommStatus,
    ConsentChannel,
    IbRights,
    Industry,
    NotificationKind,
    Position,
    Priority,
    SignalKind,
    TaskKind,
    TaskStatus,
    UserRole,
)
from app.security.passwords import hash_password
from app.services.decisions import decide_for_org
from app.services.rules import ensure_default

OKVED = {"agro": "01.11", "retail": "47.11", "it": "62.01", "log": "49.41", "trade": "46.90", "mfg": "25.62", "unk": None}
SHOW_P = {"banner_ib": 0.75, "boss": 0.8, "fx_placement": 0.85, "push": 0.65, "email": 0.4, "km_call": 0.9}
# Синтетический симулятор откликов в масштабе целевых гипотез команды (CTR +15%, CR +20–25%).
# Значения демонстрируют расчёт метрик, это не прогноз и не результат пилота.
RATES = {"test": {"click": 0.092, "convert": 0.27, "hide": 0.02}, "control": {"click": 0.08, "convert": 0.25, "hide": 0.045}}


class Quasi:
    """Квазислучайная выборка: число событий близко к доле p даже на малых выборках (меньше шума в синтетике)."""

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.acc: dict[object, float] = {}

    def hit(self, key: object, p: float) -> bool:
        a = self.acc.get(key, self.rng.random()) + p
        if a >= 1:
            self.acc[key] = a - 1
            return True
        self.acc[key] = a
        return False


def peak_month_in_window(today: date) -> int:
    """Месяц, до начала которого ≈5 недель: демо-агрохолдинг попадает в окно 4–6 недель до пика закупок."""
    best = (999, today.month)
    for k in range(1, 4):
        y, m = today.year + (today.month + k - 1) // 12, (today.month + k - 1) % 12 + 1
        best = min(best, (abs((date(y, m, 1) - today).days - 35), m))
    return best[1]


def turnover(rng: random.Random, peak: int, base: float, amplitude: float) -> list[float]:
    vals = []
    for m in range(1, 13):
        dist = min(abs(m - peak), 12 - abs(m - peak))
        vals.append(round(base * (1 + amplitude * max(0.0, 1 - dist / 3)) * rng.uniform(0.94, 1.06), 1))
    vals[peak - 1] = round(max(vals) * 1.06, 1)
    return vals


GEN_NAMES = [
    "Северный Терминал", "Волга-Агро", "Техносфера", "Каскад-Ритейл", "Бета-Логистик", "Уральский Металл", "Кубань-Зерно", "Инфосистемы",
    "Балт-Экспорт", "Город-Маркет", "Сибирь-Транс", "Прометей-Софт", "Донской Урожай", "Восток-Логистика", "Стальпром", "Оптима-Трейд",
    "Северная Нива", "Цифровые Решения", "Мега-Опт", "Приволжский Завод", "Черноземье", "Азия-Импорт", "Нева-Логистик", "Альтаир-Ритейл",
    "Полимер-Пласт", "Степной Колос", "Квант-Девелопмент", "Терра-Трейд", "Ладога-Транс", "Новатор-Пром", "Зелёный Двор", "Бизнес-Облако",
    "Енисей-Агро", "Порт-Сервис", "Империал-Фуд",
]
GEN_INDUSTRIES = ["agro", "retail", "it", "log", "trade", "mfg", "agro", "retail", "log", "unk"]


async def reset_all(session: AsyncSession) -> None:
    for table in reversed(Base.metadata.sorted_tables):
        await session.execute(table.delete())
    await session.commit()


def _user(email: str, name: str, role: UserRole, pwd_hash: str) -> User:
    u = User(email=email, full_name=name, role=role, password_hash=pwd_hash)
    u.settings = UserSettings()
    return u


async def seed(session: AsyncSession, *, now: datetime | None = None) -> dict:
    rng = random.Random(13)
    now = now or utcnow()
    today = now.date()
    pwd = hash_password(DEMO_PASSWORD)
    await ensure_default(session)

    admin = _user("admin@demo.local", "Администратор Демо", UserRole.admin, pwd)
    analyst = _user("analyst@demo.local", "Анна Смирнова", UserRole.analyst, pwd)
    km1 = _user("km.ivanova@demo.local", "Ольга Иванова", UserRole.manager, pwd)
    km2 = _user("km.petrov@demo.local", "Дмитрий Петров", UserRole.manager, pwd)
    fd_pole = _user("fd@pole-invest.demo", "Мария Ковалёва", UserRole.client, pwd)
    owner_pole = _user("owner@pole-invest.demo", "Игорь Соколов", UserRole.client, pwd)
    buh_kod = _user("buh@kod-servis.demo", "Елена Орлова", UserRole.client, pwd)
    fd_vostok = _user("fd@vostok-import.demo", "Тимур Галиев", UserRole.client, pwd)
    session.add_all([admin, analyst, km1, km2, fd_pole, owner_pole, buh_kod, fd_vostok])
    await session.flush()

    peak = peak_month_in_window(today)
    inn_seq = iter(range(9900000001, 9900099999))

    def org(name: str, industry: str, *, revenue: int, logins: int, seasonal: bool = False, peak_m: int | None = None,
            group: CompanyGroup | None = None, head: bool = False, balance: str | None = None, manager: User = km1,
            variant: AbVariant = AbVariant.test, base: float = 400.0) -> Organization:
        p = peak_m or rng.randint(1, 12)
        o = Organization(
            name=name, inn=str(next(inn_seq)), group_id=group.id if group else None, head_of_group=head, industry=Industry(industry),
            okved=OKVED[industry], revenue_mln=revenue, turnover_by_month=turnover(rng, p, base, 0.9 if seasonal else 0.15),
            seasonal=seasonal, logins_30d=logins, balance_kind=BalanceKind(balance) if balance else None, manager_id=manager.id,
            ab_variant=group.ab_variant if group else variant,
        )
        session.add(o)
        return o

    def contact(o: Organization, label: str, *, pos: str | None, rights: str | None, boss: bool = False, primary: bool = False,
                user: User | None = None) -> Contact:
        c = Contact(org_id=o.id, label=label, crm_position=Position(pos) if pos else None, ib_rights=IbRights(rights) if rights else None,
                    boss_access=boss, is_primary=primary, user_id=user.id if user else None)
        session.add(c)
        return c

    # A · Агрохолдинг: группа, ФД из CRM, средняя активность, пик закупок через ~5 недель
    g_pole = CompanyGroup(name="Группа «Поле-Инвест»", ab_variant=AbVariant.test)
    g_vector = CompanyGroup(name="Группа «Вектор»", ab_variant=AbVariant.test)
    session.add_all([g_pole, g_vector])
    await session.flush()
    pole = org("ООО «Поле-Инвест»", "agro", revenue=8_500, logins=4, seasonal=True, peak_m=peak, group=g_pole, head=True, balance="credit", base=620)
    pole_trans = org("ООО «Поле-Транс»", "log", revenue=2_900, logins=2, group=g_pole, balance="surplus", base=280)
    pole_market = org("ООО «Поле-Маркет»", "retail", revenue=1_100, logins=6, group=g_pole, balance="surplus", base=100)
    # B · IT-компания: бухгалтер, роль выведена по правам в ИБ, высокая активность
    kod = org("АО «Код-Сервис»", "it", revenue=3_200, logins=22, base=260)
    # C · Логистика: роли нет в CRM, клиент не заходит в ИБ
    trans = org("ООО «Транс-Линия»", "log", revenue=4_100, logins=0, base=330)
    # D · Импортёр: ФД, крупный бизнес, валютный платёж сегодня
    vostok = org("ТД «Восток-Импорт»", "trade", revenue=12_400, logins=12, base=1_000, manager=km1)
    # Диверсифицированная группа: нет отрасли ≥ 50%
    vec_soft = org("АО «Вектор Софт»", "it", revenue=5_200, logins=15, group=g_vector, head=True, balance="surplus", base=400, manager=km2)
    vec_retail = org("ООО «Вектор Ритейл»", "retail", revenue=4_300, logins=9, group=g_vector, balance="credit", base=350, manager=km2)
    vec_plant = org("ООО «Вектор Завод»", "mfg", revenue=3_100, logins=3, group=g_vector, balance="credit", base=250, manager=km2)
    # Контроль A/B: такой же агробизнес, но получает AS IS
    agro_yug = org("ООО «Агро-Юг»", "agro", revenue=6_100, logins=5, seasonal=True, peak_m=peak, variant=AbVariant.control, base=500)
    await session.flush()

    contact(pole, "ФД головной компании", pos="fd", rights="second_signature", boss=True, primary=True, user=fd_pole)
    contact(pole, "Собственник", pos="owner", rights="first_signature", boss=True, user=owner_pole)
    contact(pole, "Главный бухгалтер", pos="acc", rights="second_signature")
    contact(pole_trans, "Директор", pos=None, rights="first_signature", boss=False, primary=True)
    contact(pole_market, "Бухгалтер", pos="acc", rights="second_signature", primary=True)
    contact(kod, "Главный бухгалтер", pos=None, rights="second_signature", boss=False, primary=True, user=buh_kod)
    contact(kod, "Генеральный директор", pos=None, rights="first_signature", boss=True)
    contact(trans, "Контакт из анкеты", pos=None, rights=None, primary=True)
    contact(vostok, "Финансовый директор", pos="fd", rights="second_signature", boss=True, primary=True, user=fd_vostok)
    contact(vec_soft, "Финансовый директор группы", pos="fd", rights="second_signature", boss=True, primary=True)
    contact(vec_retail, "Бухгалтер", pos="acc", rights="second_signature", primary=True)
    contact(vec_plant, "Директор", pos="owner", rights="first_signature", primary=True)
    contact(agro_yug, "Финансовый директор", pos="fd", rights="second_signature", boss=True, primary=True)

    session.add(Signal(org_id=vostok.id, kind=SignalKind.fx_payment, note="Платёж поставщику в CNY", created_at=now, expires_at=now + timedelta(days=5)))

    # Сгенерированные компании: самостоятельные и небольшие группы, половина — контроль A/B
    gen_orgs: list[Organization] = []
    names = [n if k == 0 else f"{n}-{k + 1}" for k in range(3) for n in GEN_NAMES]
    for i, name in enumerate(names):
        ind = GEN_INDUSTRIES[i % len(GEN_INDUSTRIES)]
        variant = AbVariant.test if i % 2 == 0 else AbVariant.control
        seasonal = ind in ("agro", "retail") and rng.random() < 0.7
        o = org(f"ООО «{name}»", ind, revenue=rng.choice([700, 1_200, 2_500, 4_000, 6_500, 9_000, 14_000, 25_000]),
                logins=rng.choice([0, 1, 3, 5, 9, 14, 20, 26]), seasonal=seasonal, variant=variant,
                manager=km1 if i % 3 else km2, base=rng.uniform(80, 900))
        gen_orgs.append(o)
    # Две сгенерированные группы
    for gi, (gname, variant) in enumerate([("Группа «Северный Терминал»", AbVariant.control), ("Группа «Кубань-Зерно»", AbVariant.test)]):
        g = CompanyGroup(name=gname, ab_variant=variant)
        session.add(g)
        await session.flush()
        head = gen_orgs[gi * 6]
        sub = gen_orgs[gi * 6 + 1]
        for o, is_head, bal in ((head, True, "credit"), (sub, False, "surplus")):
            o.group_id, o.head_of_group, o.ab_variant, o.balance_kind = g.id, is_head, variant, BalanceKind(bal)
    await session.flush()
    for o in gen_orgs:
        n = rng.choice([1, 2, 2, 3])
        for k in range(n):
            pos = rng.choice(["owner", "fd", "acc", "ops", None, None]) if k else rng.choice(["acc", "acc", "fd", None, "owner"])
            rights = rng.choice(["first_signature", "second_signature", "none", None])
            contact(o, f"Контакт {k + 1}", pos=pos, rights=rights, boss=rights == "first_signature" or rng.random() < 0.2, primary=k == 0)
    await session.flush()

    # Согласия и события
    session.add(Consent(org_id=gen_orgs[3].id, channel=ConsentChannel.all, opted_out=True, updated_at=now - timedelta(days=20)))
    session.add(Consent(org_id=gen_orgs[4].id, channel=ConsentChannel.email, opted_out=True, updated_at=now - timedelta(days=12)))
    session.add(Consent(org_id=gen_orgs[7].id, channel=ConsentChannel.push, opted_out=True, updated_at=now - timedelta(days=40)))
    session.add(Signal(org_id=gen_orgs[2].id, kind=SignalKind.bki_request, note="Запрос кредитной истории сторонним банком",
                       created_at=now - timedelta(days=1), expires_at=now + timedelta(days=13)))
    session.add(Signal(org_id=gen_orgs[8].id, kind=SignalKind.deposit_ending, note="Депозит до " + (today + timedelta(days=10)).strftime("%d.%m"),
                       created_at=now - timedelta(days=4), expires_at=now + timedelta(days=10)))
    await session.commit()
    await seed_dataset(session, rng, now, km1.id, km2.id, history=False)
    # Дальше движок читает профили из БД: начинаем с чистой identity map, чтобы связи загрузились полностью
    session.expunge_all()

    demo_ids = {pole.id, pole_trans.id, pole_market.id, kod.id, vostok.id}
    stats = await _history(session, rng, now, demo_ids)
    await _journeys(session, rng, now)
    await _work_items(session, now, km1=km1, km2=km2, fd_pole=fd_pole, buh_kod=buh_kod, fd_vostok=fd_vostok, pole=pole, kod=kod, trans=trans,
                      vostok=vostok, gen=gen_orgs)
    await session.commit()
    return stats


DATASET_FILE = Path(__file__).resolve().parent / "data" / "dataset_calibration.json"


def calibrated_rules(calibration: dict) -> dict:
    """Стартовые правила, где матрица «отрасль × продукт» уточнена по похожим клиентам СКБ из датасета кейса."""
    cfg = RulesConfig.model_validate(DEFAULT_RULES).model_dump()
    for ind, row in calibration["industry_k"].items():
        cfg["industry_k"].setdefault(ind, {}).update(row)
    return cfg


async def seed_dataset(session: AsyncSession, rng: random.Random, now: datetime, km1_id: int, km2_id: int, *, history: bool) -> int:
    """Компании из датасета кейса (выборка СКБ) и правила v2, откалиброванные по нему. Повторный вызов ничего не делает."""
    if not DATASET_FILE.exists():
        return 0
    if (await session.execute(select(func.count()).select_from(Organization).where(Organization.dataset_uid.is_not(None)))).scalar_one():
        return 0
    data = json.loads(DATASET_FILE.read_text(encoding="utf-8"))
    if not (await session.execute(select(RuleSet).where(RuleSet.version == 2))).scalar_one_or_none():
        await session.execute(update(RuleSet).values(is_active=False))
        session.add(RuleSet(version=2, config=calibrated_rules(data), is_active=True,
                            comment=f"Матрица «отрасль × продукт» по датасету кейса: {data['stats']['skb_clients']} клиентов СКБ"))
    groups: dict[str, CompanyGroup] = {}
    created: list[Organization] = []
    inn = 9900500000
    for i, c in enumerate(data["sample"]):
        g = None
        if c["group"]:
            g = groups.get(c["group"])
            if g is None:
                g = CompanyGroup(name=f"Группа {c['group'].split('_')[1]} (датасет)",
                                 ab_variant=AbVariant.test if len(groups) % 2 == 0 else AbVariant.control)
                session.add(g)
                await session.flush()
                groups[c["group"]] = g
        seasonal = c["industry"] in ("agro", "retail") and rng.random() < 0.7
        base = max(20.0, c["revenue_mln"] / 12)
        o = Organization(
            name=f"Компания {c['uid']} · {c['city'].replace('г. ', '')}"[:200], inn=str(inn + i), group_id=g.id if g else None,
            head_of_group=bool(g) and not any(x.group_id == g.id for x in created), industry=Industry(c["industry"]), okved=c["okved"],
            revenue_mln=c["revenue_mln"], turnover_by_month=turnover(rng, rng.randint(1, 12), base, 0.9 if seasonal else 0.15),
            seasonal=seasonal, logins_30d=rng.choice([0, 1, 3, 5, 9, 14, 20]),  # активности в датасете нет — синтетика
            balance_kind=BalanceKind(c["balance"]) if c["balance"] else None, manager_id=km1_id if i % 2 else km2_id,
            ab_variant=g.ab_variant if g else (AbVariant.test if i % 2 == 0 else AbVariant.control),
            dataset_uid=c["uid"], owned_products=c["owned"], foreign_trade=c["foreign_trade"],
        )
        session.add(o)
        created.append(o)
    await session.flush()
    for o, c in zip(created, data["sample"], strict=True):
        # «Наличие ключевого собственника» из датасета → в CRM роли нет, но первая подпись и Альфа-Босс у собственника
        if c["key_owner"]:
            session.add(Contact(org_id=o.id, label="Ключевой собственник", ib_rights=IbRights.first_signature, boss_access=True, is_primary=True))
        else:
            pos = rng.choice(["fd", "acc", None, "owner"])
            session.add(Contact(org_id=o.id, label="Контакт из CRM", crm_position=Position(pos) if pos else None,
                                ib_rights=rng.choice([IbRights.second_signature, IbRights.first_signature, None]), is_primary=True))
        if c["foreign_trade"] and rng.random() < 0.15:
            session.add(Signal(org_id=o.id, kind=SignalKind.fx_payment, note=f"Платёж: {c['countries'].split(',')[0].title() or 'зарубежный поставщик'}",
                               created_at=now, expires_at=now + timedelta(days=5)))
    await session.commit()
    if history:
        session.expunge_all()
        await _history(session, rng, now, set(), only={o.id for o in created})
        await session.commit()
    return len(created)


async def _history(session: AsyncSession, rng: random.Random, now: datetime, demo_ids: set[int], only: set[int] | None = None) -> dict:
    """Синтетическая история коммуникаций за 13 недель: тест — решения движка, контроль — AS IS каждому юрлицу."""
    orgs = list((await session.execute(select(Organization).order_by(Organization.id))).scalars())
    if only is not None:
        orgs = [o for o in orgs if o.id in only]
    units: dict[object, list[Organization]] = {}
    for o in orgs:
        units.setdefault(o.group_id or f"solo-{o.id}", []).append(o)
    comms = 0
    quasi = Quasi(rng)
    for members in units.values():
        head = next((o for o in members if o.head_of_group), members[0])
        bundle = await decide_for_org(session, head)
        r = bundle.result
        variant = bundle.variant.value
        if r.suppressed:
            continue
        lvl = r.activity_level
        every = {"high": 1, "mid": 2, "low": 4}[lvl] if variant == "test" else 1
        for weeks_ago in range(13, 2, -1):
            if weeks_ago % every:
                continue
            created = now - timedelta(weeks=weeks_ago, hours=rng.randint(0, 72))
            if variant == "test":
                if not r.offer:
                    continue
                code = r.offer.product_code if rng.random() < 0.8 else next((x.code for x in r.rows[1:] if x.total > 0), r.offer.product_code)
                targets = [(head, [c.code for c in r.channels][:2] or ["banner_ib"], r.recipient)]
                headline, body, cta = r.offer.headline, r.offer.body, r.offer.cta
            else:
                code = r.as_is.product_code
                targets = [(o, ["banner_ib"], r.as_is.who) for o in members]
                headline, body, cta = r.as_is.headline, "Финансирование для вашего бизнеса. Рассчитайте условия онлайн.", "Рассчитать условия"
            for target, channels, recipient in targets:
                for ch in channels:
                    c = Communication(org_id=target.id, group_id=target.group_id, variant=AbVariant(variant), product_code=code, channel=Channel(ch),
                                      recipient=recipient[:200], headline=headline, body=body, cta=cta, visual=PRODUCTS[code].visual,
                                      status=CommStatus.sent, created_at=created, sent_at=created)
                    rates = RATES[variant]
                    if quasi.hit((variant, ch, "show"), SHOW_P[ch]):
                        c.shown_at = created + timedelta(hours=rng.uniform(0.2, 30))
                        c.status = CommStatus.shown
                        if quasi.hit((variant, "click"), rates["click"]):
                            c.clicked_at = c.shown_at + timedelta(minutes=rng.uniform(0.2, 40))
                            c.clicks = 1
                            c.status = CommStatus.clicked
                            if quasi.hit((variant, "convert"), rates["convert"]):
                                c.converted_at = c.shown_at + timedelta(hours=rng.uniform(2, 72) if variant == "test" else rng.uniform(6, 140))
                                c.status = CommStatus.converted
                        elif quasi.hit((variant, "hide"), rates["hide"]) and not (target.id in demo_ids and weeks_ago < 6):
                            c.hidden_at = c.shown_at + timedelta(minutes=5)
                            c.status = CommStatus.hidden
                    session.add(c)
                    comms += 1
    await session.flush()

    # Заявки по конверсиям (атрибуция к коммуникации)
    converted = list((await session.execute(select(Communication).where(Communication.converted_at.is_not(None)))).scalars())
    statuses = [AppStatus.approved] * 9 + [AppStatus.declined] * 3 + [AppStatus.in_review] * 3 + [AppStatus.submitted] * 2 + [AppStatus.cancelled] * 2 + [AppStatus.needs_info]
    org_by_id = {o.id: o for o in orgs}
    for c in converted:
        st = rng.choice(statuses)
        a = Application(number="—", org_id=c.org_id, product_code=c.product_code, amount_rub=rng.choice([5, 10, 15, 20, 30, 50, 80]) * 1_000_000,
                        term_months=rng.choice([6, 12, 18, 24, 36]), status=st, source=AppSource.web, communication_id=c.id,
                        assignee_id=org_by_id[c.org_id].manager_id, created_at=c.converted_at, updated_at=c.converted_at + timedelta(days=2),
                        submitted_at=c.converted_at, decided_at=c.converted_at + timedelta(days=3) if st in (AppStatus.approved, AppStatus.declined) else None)
        session.add(a)
        await session.flush()
        a.number = f"З-{a.created_at.year}-{a.id:06d}"
        session.add(StatusChange(entity_type="application", entity_id=a.id, from_status=None, to_status="submitted", created_at=a.created_at))
        if st != AppStatus.submitted:
            session.add(StatusChange(entity_type="application", entity_id=a.id, from_status="submitted", to_status=st.value,
                                     created_at=a.created_at + timedelta(days=2)))
    await session.flush()
    return {"organizations": len(orgs), "communications": comms, "applications": len(converted)}


async def _journeys(session: AsyncSession, rng: random.Random, now: datetime) -> None:
    """Синтетические сессии пути: адаптивный интерфейс (тест) против статичного (контроль)."""
    orgs = list((await session.execute(select(Organization))).scalars())
    for _ in range(160):
        o = rng.choice(orgs)
        adapt = o.effective_variant == AbVariant.test
        started = now - timedelta(days=rng.uniform(3, 60))
        reached_calc = rng.random() < (0.82 if adapt else 0.78)
        reached_form = reached_calc and rng.random() < (0.62 if adapt else 0.47)
        applied = reached_form and rng.random() < (0.78 if adapt else 0.70)
        tta = int(rng.uniform(70, 220) if adapt else rng.uniform(110, 330)) if applied else None
        js = JourneySession(org_id=o.id, product_code=rng.choice(["working", "leasing", "deposit", "factoring"]), source=rng.choice(["web", "miniapp"]),
                            adapt=adapt, variant=o.effective_variant, outcome="applied" if applied else "abandoned",
                            steps=rng.randint(2, 9), returns=rng.choice([0, 0, 1, 2, 3]), recalcs=rng.choice([0, 1, 2, 3, 4]) if reached_calc else 0,
                            hints_shown=(1 if adapt and rng.random() < 0.4 else 0), state={}, started_at=started, last_event_at=started,
                            finished_at=started + timedelta(seconds=tta) if tta else None, time_to_apply_sec=tta)
        js.hints_closed = 1 if js.hints_shown and rng.random() < 0.3 else 0
        session.add(js)
        await session.flush()
        events = [("view", "showcase")] + ([("view", "calc")] if reached_calc else []) + ([("view", "form")] if reached_form else [])
        for k, (kind, screen) in enumerate(events):
            session.add(JourneyEvent(session_id=js.id, kind=kind, screen=screen, meta={}, created_at=started + timedelta(seconds=10 + k * 30)))
    await session.flush()


async def _work_items(session: AsyncSession, now: datetime, *, km1: User, km2: User, fd_pole: User, buh_kod: User, fd_vostok: User,
                      pole: Organization, kod: Organization, trans: Organization, vostok: Organization, gen: list[Organization]) -> None:
    """Заявки, переписка, задачи и уведомления для демо-сценариев."""

    async def application(o: Organization, author: User, product: str, amount: int, term: int, status: AppStatus, days_ago: float,
                          comment: str | None = None) -> Application:
        created = now - timedelta(days=days_ago)
        a = Application(number="—", org_id=o.id, created_by=author.id, assignee_id=o.manager_id, product_code=product, amount_rub=amount,
                        term_months=term, comment=comment, status=status, source=AppSource.miniapp, created_at=created,
                        updated_at=created + timedelta(hours=20), submitted_at=created)
        session.add(a)
        await session.flush()
        a.number = f"З-{created.year}-{a.id:06d}"
        session.add(StatusChange(entity_type="application", entity_id=a.id, from_status=None, to_status="submitted", actor_id=author.id, created_at=created))
        return a

    a1 = await application(pole, fd_pole, "leasing", 45_000_000, 12, AppStatus.in_review, 6, "Два трактора к посевной")
    session.add(StatusChange(entity_type="application", entity_id=a1.id, from_status="submitted", to_status="in_review", actor_id=km1.id,
                             created_at=now - timedelta(days=5)))
    session.add(ApplicationComment(application_id=a1.id, author_id=km1.id, body="Заявку получила, проверяю обороты группы. Вернусь с условиями до пятницы.",
                                   created_at=now - timedelta(days=5)))
    session.add(ApplicationComment(application_id=a1.id, author_id=km1.id, body="Внутреннее: оборот головной компании покрывает лимит, нужен поручитель — Поле-Транс.",
                                   internal=True, created_at=now - timedelta(days=4)))
    a2 = await application(kod, buh_kod, "digital", 500_000, 12, AppStatus.needs_info, 9, "Подключение 1С к выписке")
    for frm, to, actor, days, cmt in (("submitted", "in_review", km1, 8, None),
                                      ("in_review", "needs_info", km1, 7, "Пришлите, пожалуйста, версию 1С и список счетов для синхронизации.")):
        session.add(StatusChange(entity_type="application", entity_id=a2.id, from_status=frm, to_status=to, actor_id=actor.id, comment=cmt,
                                 created_at=now - timedelta(days=days)))
    session.add(ApplicationComment(application_id=a2.id, author_id=km1.id, body="Пришлите, пожалуйста, версию 1С и список счетов для синхронизации.",
                                   created_at=now - timedelta(days=7)))
    a3 = await application(pole, fd_pole, "deposit", 30_000_000, 6, AppStatus.approved, 40)
    a3.decided_at = now - timedelta(days=38)
    session.add(StatusChange(entity_type="application", entity_id=a3.id, from_status="submitted", to_status="approved", actor_id=km1.id,
                             created_at=now - timedelta(days=38)))
    a4 = await application(vostok, fd_vostok, "factoring", 80_000_000, 6, AppStatus.submitted, 1)
    await session.flush()

    def task(o: Organization, kind: TaskKind, title: str, desc: str, prio: Priority, due_h: float, status: TaskStatus = TaskStatus.open,
             assignee: User = km1, app: Application | None = None, created_days: float = 1) -> Task:
        t = Task(org_id=o.id, assignee_id=assignee.id, kind=kind, title=title, description=desc, priority=prio, status=status, source="rule",
                 due_at=now + timedelta(hours=due_h), application_id=app.id if app else None, dedupe_key=f"seed:{kind.value}:{o.id}:{title[:40]}",
                 created_at=now - timedelta(days=created_days), updated_at=now - timedelta(days=created_days),
                 completed_at=now - timedelta(days=1) if status == TaskStatus.done else None)
        session.add(t)
        return t

    task(gen[2], TaskKind.call_48h, "Позвонить: клиент ищет кредит в другом банке", "Сигнал: запрос в БКИ от стороннего банка.", Priority.high, 30)
    task(trans, TaskKind.update_crm_role, "Уточнить роль ЛПР в CRM", "Роль не указана, в ИБ нет пользователей — персонализация работает в нейтральном режиме.",
         Priority.low, 24 * 10)
    task(trans, TaskKind.meeting, "Обсудить «Лизинг» на встрече", "Клиент не заходит в цифровые каналы — канал по активности: менеджер.", Priority.normal, -20,
         created_days=8)
    task(vostok, TaskKind.application_review, f"Рассмотреть заявку {a4.number}: Факторинг", "80,0 млн ₽ на 6 мес. Источник: Mini App.", Priority.high, 40, app=a4)
    task(pole, TaskKind.application_review, f"Рассмотреть заявку {a1.number}: Лизинг", "45,0 млн ₽ на 12 мес.", Priority.high, -2,
         status=TaskStatus.in_progress, app=a1, created_days=6)
    task(gen[8], TaskKind.call_48h, "Предложить пролонгацию депозита", "Депозит заканчивается через 10 дней.", Priority.normal, 48, assignee=km2)
    task(gen[5], TaskKind.hesitation, "Клиент сомневается в расчёте: Лизинг", "Пересчётов 4, возвратов на витрину 2.", Priority.high, -30,
         status=TaskStatus.done, created_days=3)
    await session.flush()

    for user, title, body, link, kind in (
        (fd_pole, f"Заявка {a1.number}: На рассмотрении", "Оборотный кредит. Менеджер проверяет обороты группы.", f"/applications/{a1.id}", NotificationKind.application),
        (fd_pole, f"Комментарий к заявке {a1.number}", "Заявку получила, проверяю обороты группы.", f"/applications/{a1.id}", NotificationKind.application),
        (buh_kod, f"Заявка {a2.number}: Нужны уточнения", "Пришлите версию 1С и список счетов.", f"/applications/{a2.id}", NotificationKind.application),
        (km1, f"Новая заявка {a4.number}", "ТД «Восток-Импорт»: Факторинг, 80,0 млн ₽", f"/applications/{a4.id}", NotificationKind.application),
    ):
        session.add(Notification(user_id=user.id, kind=kind, title=title, body=body, link=link, tg_status="skipped",
                                 created_at=now - timedelta(hours=rng_hours(title))))
    await session.flush()


def rng_hours(seed_text: str) -> float:
    return 2 + (sum(map(ord, seed_text)) % 40)


async def main(reset: bool) -> None:
    s = get_settings()
    async with dbmod.session_factory()() as session:
        has_users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
        if has_users and not reset:
            # Обновление развёрнутой базы: компании из датасета кейса и правила v2 добавляются один раз
            kms = list((await session.execute(select(User.id).where(User.role == UserRole.manager).order_by(User.id))).scalars())
            added = await seed_dataset(session, random.Random(17), utcnow(), kms[0], kms[-1], history=True) if kms else 0
            print(f"Демо-данные уже есть; добавлено компаний из датасета: {added}. Для пересоздания: python -m app.seed --reset")
            return
        if reset:
            if s.is_production:
                raise SystemExit("Сброс данных запрещён при ENVIRONMENT=production")
            await reset_all(session)
        stats = await seed(session)
    print(f"Готово: {stats}. Пароль демо-учёток — в README (раздел «Демо-доступы»).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Синтетические демо-данные")
    parser.add_argument("--reset", action="store_true", help="очистить БД перед заполнением")
    asyncio.run(main(parser.parse_args().reset))
