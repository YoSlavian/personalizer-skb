"""Ограничение частоты запросов в памяти процесса (скользящее окно).

Для нескольких инстансов замените на Redis (INCR + EXPIRE) — интерфейс тот же.
"""

import time
from collections import deque
from threading import Lock


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float, max_keys: int = 50_000) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def hit(self, key: str, now: float | None = None) -> tuple[bool, float]:
        """Регистрирует попытку. Возвращает (разрешено, секунд до сброса)."""
        t = now if now is not None else time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                if len(self._hits) >= self.max_keys:
                    self._evict(t)
                q = self._hits[key] = deque()
            while q and t - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False, self.window - (t - q[0])
            q.append(t)
            return True, 0.0

    def blocked(self, key: str, now: float | None = None) -> float:
        t = now if now is not None else time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 0.0
            while q and t - q[0] >= self.window:
                q.popleft()
            return self.window - (t - q[0]) if len(q) >= self.limit else 0.0

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()

    def _evict(self, t: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or t - q[-1] >= self.window]:
            del self._hits[k]
