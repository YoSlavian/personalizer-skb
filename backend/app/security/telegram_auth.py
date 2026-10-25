"""Проверка подписи Telegram Web App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Идентификатору пользователя из клиента не доверяем: берём его только из initData после проверки HMAC.
"""

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl


class InitDataError(ValueError):
    pass


@dataclass(frozen=True)
class TelegramWebAppUser:
    id: int
    first_name: str
    username: str | None
    auth_date: int
    start_param: str | None


def validate_init_data(init_data: str, bot_token: str, *, max_age_seconds: int, now: float | None = None) -> TelegramWebAppUser:
    if not init_data or len(init_data) > 4096:
        raise InitDataError("Пустые или слишком длинные initData")
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise InitDataError("Нет подписи hash")
    pairs.pop("signature", None)  # Ed25519-подпись для третьих сторон; для бота достаточно HMAC
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("Подпись initData не совпадает")
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError as e:
        raise InitDataError("Некорректный auth_date") from e
    current = now if now is not None else time.time()
    if auth_date <= 0 or current - auth_date > max_age_seconds:
        raise InitDataError("initData устарели")
    try:
        user = json.loads(pairs.get("user", "{}"))
        uid = int(user["id"])
    except (ValueError, KeyError, TypeError) as e:
        raise InitDataError("Нет данных пользователя") from e
    return TelegramWebAppUser(
        id=uid,
        first_name=str(user.get("first_name", ""))[:64],
        username=(str(user["username"])[:64] if user.get("username") else None),
        auth_date=auth_date,
        start_param=pairs.get("start_param"),
    )


def sign_init_data(fields: dict[str, str], bot_token: str) -> str:
    """Формирует корректно подписанные initData (для тестов и локальной отладки Mini App)."""
    from urllib.parse import urlencode

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    h = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": h})
