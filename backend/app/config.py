import hashlib
import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


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
        # Хостинги (Render, Railway, Heroku) выдают postgres://… без драйвера — приложению нужен asyncpg
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix):]
        return v

    @model_validator(mode="after")
    def _platform_url(self) -> "Settings":
        # Render сам сообщает внешний HTTPS-адрес сервиса
        if not self.public_base_url and os.environ.get("RENDER_EXTERNAL_URL"):
            self.public_base_url = os.environ["RENDER_EXTERNAL_URL"]
        return self

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
