import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")
log = logging.getLogger("integrations")


class IntegrationError(RuntimeError):
    pass


async def with_retry(
    name: str,
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    timeout: float = 5.0,
    base_delay: float = 0.3,
    retry_on: tuple[type[BaseException], ...] = (Exception,),
) -> T:
    """Вызов внешней системы с тайм-аутом и экспоненциальной задержкой между повторами."""
    last: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await asyncio.wait_for(fn(), timeout=timeout)
        except retry_on as e:  # noqa: PERF203
            last = e
            log.warning("%s: попытка %s/%s не удалась: %s", name, attempt, attempts, type(e).__name__)
            if attempt < attempts:
                await asyncio.sleep(base_delay * 2 ** (attempt - 1))
    raise IntegrationError(f"{name}: исчерпаны попытки") from last
