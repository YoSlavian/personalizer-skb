"""Справочники движка: отрасли, роли ЛПР, продукты, каналы. Названия совпадают с прототипом команды."""

from dataclasses import dataclass


@dataclass(frozen=True)
class IndustryInfo:
    code: str
    name: str
    seasonal: bool = False


@dataclass(frozen=True)
class RoleInfo:
    code: str
    name: str
    lpr: bool
    focus: str


@dataclass(frozen=True)
class ProductInfo:
    code: str
    name: str
    category: str
    lpr: bool  # решение принимает ЛПР (собственник или ФД)
    group: bool = False  # только для групп компаний
    large: bool = False  # только для крупного бизнеса
    visual: str = "growth"
    calculable: bool = True  # есть онлайн-калькулятор и заявка


INDUSTRIES: dict[str, IndustryInfo] = {
    i.code: i
    for i in [
        IndustryInfo("agro", "АПК", seasonal=True),
        IndustryInfo("retail", "Ритейл", seasonal=True),
        IndustryInfo("it", "IT"),
        IndustryInfo("log", "Логистика"),
        IndustryInfo("trade", "Международная торговля"),
        IndustryInfo("mfg", "Производство"),
        IndustryInfo("unk", "Не определена"),
    ]
}

ROLES: dict[str, RoleInfo] = {
    r.code: r
    for r in [
        RoleInfo("owner", "Собственник", True, "рост и инвестиции"),
        RoleInfo("fd", "Финдиректор", True, "денежный поток и ликвидность"),
        RoleInfo("acc", "Главный бухгалтер", False, "операции и учётные системы"),
        RoleInfo("ops", "Операционист", False, "ежедневные платежи"),
    ]
}

ROLE_SOURCES: dict[str, str] = {"crm": "CRM", "inferred": "Выведена по правам в ИБ", "none": "Нет данных"}

PRODUCTS: dict[str, ProductInfo] = {
    p.code: p
    for p in [
        ProductInfo("working", "Оборотный кредит", "credit", lpr=True, visual="season"),
        ProductInfo("concession", "Льготный кредит", "credit", lpr=True, visual="season"),
        ProductInfo("project", "Проектное финансирование", "credit", lpr=True, visual="growth", calculable=False),
        ProductInfo("leasing", "Лизинг", "leasing", lpr=True, visual="truck"),
        ProductInfo("factoring", "Факторинг", "factoring", lpr=True, visual="invoice"),
        ProductInfo("ved", "ВЭД: конвертация и валютный контроль", "ved", lpr=False, visual="fx", calculable=False),
        ProductInfo("deposit", "Депозит для свободных остатков", "deposit", lpr=True, visual="deposit"),
        ProductInfo("digital", "Интеграция с учётной системой", "digital", lpr=False, visual="sync", calculable=False),
        ProductInfo("pool", "Единый остаток группы (cash pooling)", "group", lpr=True, group=True, visual="group", calculable=False),
        ProductInfo("glimit", "Общий кредитный лимит группы", "group", lpr=True, group=True, visual="group", calculable=False),
        ProductInfo("syndic", "Синдицированный кредит или облигации", "group", lpr=True, group=True, large=True, visual="growth", calculable=False),
    ]
}

CHANNELS: dict[str, str] = {
    "boss": "Альфа-Босс: плейсмент на главной",
    "banner_ib": "Баннер на главной ИБ",
    "push": "Push-уведомление",
    "email": "Email",
    "km_call": "Звонок или встреча с КМ",
    "fx_placement": "Плейсмент в ИБ рядом с «Валютным переводом»",
}

SIGNALS: dict[str, str] = {
    "fx_payment": "Валютный платёж сегодня",
    "deposit_ending": "Депозит заканчивается в ближайшие 14 дней",
    "bki_request": "Запрос в БКИ: ищет кредит в другом банке",
}

SEGMENTS: dict[str, str] = {
    "S1": "Группы компаний",
    "S2": "АПК / сезонный",
    "S3": "Активные онлайн",
    "S4": "ВЭД",
}


def industry_name(code: str | None) -> str:
    return INDUSTRIES[code].name if code in INDUSTRIES else "Не определена"


def product_name(code: str | None) -> str:
    return PRODUCTS[code].name if code in PRODUCTS else (code or "—")


def catalog_payload() -> dict:
    """Справочники для фронтенда и бота."""
    return {
        "industries": [vars(i) for i in INDUSTRIES.values()],
        "roles": [vars(r) for r in ROLES.values()],
        "role_sources": [{"code": k, "name": v} for k, v in ROLE_SOURCES.items()],
        "products": [vars(p) for p in PRODUCTS.values()],
        "channels": [{"code": k, "name": v} for k, v in CHANNELS.items()],
        "signals": [{"code": k, "name": v} for k, v in SIGNALS.items()],
        "segments": [{"code": k, "name": v} for k, v in SEGMENTS.items()],
    }
