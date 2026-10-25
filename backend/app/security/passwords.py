from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()
# Хеш-заглушка: проверка выполняется даже для несуществующего email, чтобы время ответа не выдавало наличие учётки
_DUMMY_HASH = _ph.hash("timing-equalizer-not-a-real-password")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _ph.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


def validate_password_strength(password: str) -> str | None:
    if len(password) < 8:
        return "Пароль должен быть не короче 8 символов"
    if password.isdigit() or password.isalpha():
        return "Пароль должен содержать буквы и цифры"
    return None
