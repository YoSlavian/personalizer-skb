import hashlib
import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Параметры libpq, которых не понимает asyncpg; TLS задаётся его собственным параметром ssl
_LIBPQ_ONLY = {"sslmode", "channel_binding"}


def asyncpg_url(v: str) -> str:
    """Хостинги (Render, Neon, Heroku) выдают postgres://… для libpq — приложению нужен asyncpg."""
    for prefix in ("postgres://", "postgresql://"):
        if v.startswith(prefix):
            v = "postgresql+asyncpg://" + v[len(prefix):]
            break
    if not v.startswith("postgresql+asyncpg://") or "?" not in v:
        return v
    base, query = v.split("?", 1)
    params = [p for p in query.split("&") if p]
    ssl = any(p.split("=", 1)[0] == "sslmode" and p.split("=", 1)[-1] in ("require", "verify-ca", "verify-full") for p in params)
    kept = [p for p in params if p.split("=", 1)[0] not in _LIBPQ_ONLY]
    if ssl and not any(p.startswith("ssl=") for p in kept):
        kept.append("ssl=require")
    return base + ("?" + "&".join(kept) if kept else "")


class Settings(BaseSettings):
    """Конфигурация из переменных окружения (.env). Секреты не имеют значений по умолчанию."""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Персонализатор СКБ"
    environment: str = Field(default="development", description="development | test | production")
    # Демо-режим: быстрый вход под демо-персонами в вебе и боте. В production выключать.
    demo_mode: bool = True

    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_DIR / 'data' / 'app.db').as_posix()}"
    sql_echo: bool = False

    # Сессии
    session_ttl_hours: int = 12
    miniapp_session_ttl_hours: int = 6
    cookie_secure: bool = False
    cookie_domain: str | None = None

    # CORS для отдельного фронтенда в разработке (Vite). В production фронтенд отдаётся с того же домена.
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Ограничение частоты запросов (на процесс; для нескольких инстансов нужен Redis)
    rate_limit_per_minute: int = 240
    login_attempts_per_window: int = 5
    login_window_seconds: int = 300

    # Личный администратор: создаётся при запуске, если задан (пароль только в переменных окружения хостинга)
    admin_email: str | None = None
    admin_password: SecretStr | None = None
    admin_name: str = "Администратор"

    # Telegram
    telegram_bot_token: SecretStr | None = None
    telegram_bot_username: str | None = None
    telegram_webhook_secret: SecretStr | None = None
    telegram_mode: str = Field(default="polling", description="polling | webhook | off")
    public_base_url: str | None = Field(default=None, description="https://домен для webhook и Mini App")
    telegram_init_data_ttl_seconds: int = 86400
    telegram_proxy: str | None = Field(default=None, description="http://user:pass@host:port, если api.telegram.org недоступен напрямую")
    notifier_enabled: bool = True
    notifier_interval_seconds: float = 2.0

    # Фронтенд, собранный в frontend/dist, может отдаваться самим backend (один порт для демо и туннеля)
    serve_frontend: bool = True
    frontend_dist: Path = BACKEND_DIR.parent / "frontend" / "dist"

    # Адаптивный путь: в демо пауза короче, чем в продукте
    journey_idle_seconds: int = 8

    @field_validator("environment")
    @classmethod
    def _env(cls, v: str) -> str:
        if v not in {"development", "test", "production"}:
            raise ValueError("environment должен быть development, test или production")
        return v

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        return asyncpg_url(v)

    @model_validator(mode="after")
    def _platform_url(self) -> "Settings":
        # Render и Vercel сами сообщают внешний адрес сервиса
        if not self.public_base_url and os.environ.get("RENDER_EXTERNAL_URL"):
            self.public_base_url = os.environ["RENDER_EXTERNAL_URL"]
        if not self.public_base_url and os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
            self.public_base_url = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]
        # Neon на Vercel: прямое подключение без PgBouncer — у asyncpg не будет конфликтов подготовленных запросов
        if self.on_vercel and os.environ.get("DATABASE_URL_UNPOOLED"):
            self.database_url = asyncpg_url(os.environ["DATABASE_URL_UNPOOLED"])
        return self

    @property
    def on_vercel(self) -> bool:
        """Бессерверный запуск: нет постоянного процесса, фоновые циклы не работают."""
        return os.environ.get("VERCEL") == "1"

    @property
    def webhook_secret(self) -> str | None:
        """Секрет вебхука: заданный явно или выведенный из токена (Telegram допускает только [A-Za-z0-9_-])."""
        if self.telegram_webhook_secret:
            return self.telegram_webhook_secret.get_secret_value()
        if self.bot_token:
            return hashlib.sha256(f"webhook:{self.bot_token}".encode()).hexdigest()
        return None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def bot_token(self) -> str | None:
        return self.telegram_bot_token.get_secret_value() if self.telegram_bot_token else None

    @property
    def miniapp_url(self) -> str | None:
        return f"{self.public_base_url.rstrip('/')}/miniapp" if self.public_base_url else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
