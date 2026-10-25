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

# Персоны для быстрого входа в Telegram-боте в демо-режиме
BOT_DEMO_PERSONAS = {
    "client_fd": "fd@pole-invest.demo",
    "client_acc": "buh@kod-servis.demo",
    "manager": "km.ivanova@demo.local",
}
