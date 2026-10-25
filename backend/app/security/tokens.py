import hashlib
import hmac
import secrets


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    """В БД хранится только SHA-256 токена: утечка таблицы не даёт действующих сессий."""
    return hashlib.sha256(token.encode()).hexdigest()


def constant_eq(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode(), b.encode())
