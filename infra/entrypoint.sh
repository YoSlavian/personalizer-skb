#!/bin/sh
set -e

echo "Применяю миграции базы данных…"
python -m alembic upgrade head

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "Заполняю синтетические демо-данные (только если БД пустая)…"
  # Ошибка заполнения не должна мешать запуску API и бота
  python -m app.seed || echo "ВНИМАНИЕ: заполнение демо-данных завершилось ошибкой, сервис запускается без него"
fi

# Один процесс: в нём работают API, бот (polling или webhook) и доставка уведомлений.
# Несколько воркеров запустили бы несколько копий polling — Telegram ответит конфликтом.
# PORT задают хостинги (Render, Railway); локально и в docker compose — 8000.
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
