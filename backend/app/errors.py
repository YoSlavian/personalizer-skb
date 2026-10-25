"""Доменные ошибки. API превращает их в ответ {"error": {"code", "message", "details"}}."""

from typing import Any


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, *, details: Any = None, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details
        if code:
            self.code = code


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_error"


class TooManyRequests(AppError):
    status_code = 429
    code = "too_many_requests"

    def __init__(self, message: str, *, retry_after: int) -> None:
        super().__init__(message, details={"retry_after": retry_after})
        self.retry_after = retry_after
