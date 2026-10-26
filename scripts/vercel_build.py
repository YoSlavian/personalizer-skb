"""Сборка на Vercel (вместо infra/entrypoint.sh на Render): миграции, демо-данные, регистрация бота.

Запускается после установки зависимостей. Только для production-деплоя: превью-сборки не трогают базу и webhook,
иначе превью перехватило бы бота у основного адреса.
"""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def run(*args: str, fatal: bool = True) -> None:
    print("→", " ".join(args), flush=True)
    code = subprocess.call([sys.executable, *args], cwd=BACKEND)
    if code and fatal:
        sys.exit(code)
    if code:
        print(f"ВНИМАНИЕ: команда завершилась с кодом {code}, сборка продолжается", flush=True)


async def register_bot() -> None:
    sys.path.insert(0, str(BACKEND))
    from app.bot.runtime import BotRuntime
    from app.config import get_settings

    s = get_settings()
    if not s.bot_token or s.telegram_mode != "webhook":
        print("Бот не настроен (нет TELEGRAM_BOT_TOKEN или TELEGRAM_MODE не webhook) — пропускаю", flush=True)
        return
    rt = BotRuntime(s)
    try:
        await rt._setup()  # noqa: SLF001 — команды и кнопка меню с адресом Mini App
        print("Webhook:", await rt.register_webhook(), flush=True)
    finally:
        await rt.bot.session.close()


def main() -> None:
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        sys.exit("Нет frontend/dist: соберите Mini App (npm run build) и закоммитьте dist")
    if os.environ.get("VERCEL_ENV") != "production":
        print("Не production-сборка: база и бот не трогаются", flush=True)
        return
    if not os.environ.get("DATABASE_URL"):
        sys.exit("Нет DATABASE_URL: подключите Neon в Vercel → Storage и пересоберите проект")
    run("-m", "alembic", "upgrade", "head")
    if os.environ.get("SEED_DEMO", "false").lower() == "true":
        run("-m", "app.seed", fatal=False)  # заполнение только пустой базы; ошибка не мешает деплою
    try:
        asyncio.run(register_bot())
    except Exception as e:  # noqa: BLE001
        print(f"ВНИМАНИЕ: бот не зарегистрирован: {e}", flush=True)


if __name__ == "__main__":
    main()
