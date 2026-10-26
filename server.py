"""Точка входа для Vercel: FastAPI-приложение из backend/ (пакет app)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402

__all__ = ["app"]
