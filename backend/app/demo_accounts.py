"""Синтетические демо-учётки. Работают только с тестовыми данными; в production DEMO_MODE=false скрывает их из интерфейса,
а сам seed запускать на боевой базе нельзя."""

DEMO_PASSWORD = "Demo-2026!"

DEMO_ACCOUNTS = [
    {"email": "analyst@demo.local", "title": "Аналитик СКБ", "description": "Симулятор, правила, кампании, A/B-аналитика", "role": "analyst"},
    {"email": "km.ivanova@demo.local", "title": "Клиентский менеджер", "description": "Задачи от правил, заявки портфеля", "role": "manager"},
    {"email": "fd@pole-invest.demo", "title": "Клиент: ФД агрохолдинга", "description": "Группа «Поле-Инвест», АПК, роль из CRM", "role": "client"},
    {"email": "buh@kod-servis.demo", "title": "Клиент: бухгалтер IT-компании", "description": "Роль выведена по правам в ИБ", "role": "client"},
    {"email": "admin@demo.local", "title": "Администратор", "description": "Пользователи и журнал аудита", "role": "admin"},
]

DEMO_EMAILS = frozenset(a["email"] for a in DEMO_ACCOUNTS)


DEMO_CONSENTS_MESSAGE = (
    "В публичном демо отказ от коммуникаций не сохраняется: учёткой пользуются все зрители. "
    "Посмотреть, как отказ меняет решение, можно в симуляторе — тумблер «Отказ от всех маркетинговых коммуникаций»"
)

DEMO_CLIENT_CARD_MESSAGE = (
    "В публичном демо карточку клиента не меняем: ею пользуются все зрители. "
    "Откройте клиента в симуляторе — там можно менять любые признаки и сразу видеть новое решение"
)
DEMO_HINTS_MESSAGE = "В публичном демо подсказки пути не отключаются: учёткой пользуются все зрители"


def is_public_demo_viewer(user) -> bool:  # noqa: ANN001
    """Демо-учётка на публичном сервере с DEMO_MODE: её открывают все зрители сразу, поэтому её действия не должны
    менять общие данные, по которым другие видят демо."""
    from app.config import get_settings

    s = get_settings()
    return s.demo_mode and s.is_production and user.email in DEMO_EMAILS


def ensure_not_public_demo(user, message: str = "В публичном демо это действие отключено") -> None:  # noqa: ANN001
    """На публичном сервере с DEMO_MODE пароль демо-учёток известен всем: запрещаем действия, которые ломают демо другим
    (смена пароля, управление пользователями, активация правил, отказ от коммуникаций)."""
    from app.errors import Forbidden

    if is_public_demo_viewer(user):
        raise Forbidden(message, code="demo_read_only")


# Персоны для быстрого входа в Telegram-боте в демо-режиме
BOT_DEMO_PERSONAS = {
    "client_fd": "fd@pole-invest.demo",
    "client_acc": "buh@kod-servis.demo",
    "manager": "km.ivanova@demo.local",
}
