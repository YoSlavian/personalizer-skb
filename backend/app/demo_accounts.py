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


def ensure_not_public_demo(user) -> None:  # noqa: ANN001
    """На публичном сервере с DEMO_MODE пароль демо-учёток известен всем: запрещаем действия, которые ломают демо другим
    (смена пароля, управление пользователями, активация правил)."""
    from app.config import get_settings
    from app.errors import Forbidden

    s = get_settings()
    if s.demo_mode and s.is_production and user.email in DEMO_EMAILS:
        raise Forbidden("В публичном демо это действие отключено", code="demo_read_only")


# Персоны для быстрого входа в Telegram-боте в демо-режиме
BOT_DEMO_PERSONAS = {
    "client_fd": "fd@pole-invest.demo",
    "client_acc": "buh@kod-servis.demo",
    "manager": "km.ivanova@demo.local",
}
