"""FastAPI-приложение: API, вебхук Telegram, раздача Mini App, фоновая доставка уведомлений."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import db as dbmod
from app.api.routes import admin, auth, cabinet, demo, marketing, me, orgs, telegram, work
from app.config import get_settings
from app.errors import AppError
from app.security.rate_limit import SlidingWindowLimiter

log = logging.getLogger("app")
api_limiter = SlidingWindowLimiter(get_settings().rate_limit_per_minute, 60)

CSP = (
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; "
    "font-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; "
    "base-uri 'self'; form-action 'self'"
)


IB_DEMO_CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
    "frame-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
)
IB_DEMO_DIR = Path(__file__).resolve().parent.parent.parent / "ib-demo"


def _error(status: int, code: str, message: str, details=None, headers=None) -> JSONResponse:  # noqa: ANN001
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(body, status_code=status, headers=headers)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    s = get_settings()
    tasks: list[asyncio.Task] = []
    bot_runtime = None
    if s.bot_token and s.telegram_mode != "off" and s.environment != "test":
        from app.bot.runtime import BotRuntime

        bot_runtime = BotRuntime(s)
        app.state.bot_runtime = bot_runtime
        tasks.extend(await bot_runtime.start())
    elif s.environment != "test":
        log.warning("TELEGRAM_BOT_TOKEN не задан: бот и доставка уведомлений в Telegram отключены, веб и Mini App в браузере работают")
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        if bot_runtime:
            await bot_runtime.stop()
        await dbmod.engine.dispose()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Персонализатор СКБ API",
        version="1.0.0",
        description="Прототип PoC кейса «Персонализация коммуникаций с корпоративными клиентами». Только синтетические данные.",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        headers = {"Retry-After": str(exc.details["retry_after"])} if exc.status_code == 429 and isinstance(exc.details, dict) else None
        return _error(exc.status_code, exc.code, exc.message, exc.details, headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"loc": ".".join(str(x) for x in e["loc"] if x not in ("body", "query", "path")), "msg": e["msg"]} for e in exc.errors()]
        return _error(422, "validation_error", "Проверьте заполнение полей", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Необработанная ошибка %s %s", request.method, request.url.path)
        return _error(500, "server_error", "Внутренняя ошибка сервера. Попробуйте ещё раз")

    @app.middleware("http")
    async def _security(request: Request, call_next):  # noqa: ANN001, ANN202
        path = request.url.path
        if path.startswith("/api/") and path not in ("/api/health", "/api/telegram/webhook"):
            ip = request.client.host if request.client else "-"
            ok, wait = api_limiter.hit(ip)
            if not ok:
                return _error(429, "too_many_requests", "Слишком много запросов. Подождите немного", {"retry_after": int(wait) + 1},
                              {"Retry-After": str(int(wait) + 1)})
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # Демо интернет-банка — самодостаточная статическая страница со встроенными стилями и скриптами
        response.headers.setdefault("Content-Security-Policy", IB_DEMO_CSP if path.startswith("/ib-demo") else CSP)
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        if s.is_production:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    if s.cors_origins and not s.is_production:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"],
                           allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"])

    for r in (auth.router, demo.router, me.router, orgs.router, work.router, marketing.router, cabinet.router, admin.router, telegram.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health", tags=["system"])
    async def health() -> dict:
        db_ok = True
        try:
            async with dbmod.session_factory()() as session:
                await session.execute(text("SELECT 1"))
        except Exception:  # noqa: BLE001
            db_ok = False
        rt = getattr(app.state, "bot_runtime", None)
        return {
            "status": "ok" if db_ok else "degraded",
            "database": db_ok,
            "telegram": {"configured": bool(s.bot_token), "mode": s.telegram_mode if s.bot_token else "off",
                         "bot_username": s.telegram_bot_username, "running": bool(rt and rt.running)},
            "miniapp_url": s.miniapp_url,
            "demo_mode": s.demo_mode,
            "environment": s.environment,
        }

    if (IB_DEMO_DIR / "index.html").exists():
        @app.get("/ib-demo", include_in_schema=False)
        async def ib_demo_redirect() -> RedirectResponse:
            return RedirectResponse("/ib-demo/")

        @app.get("/ib-demo/", include_in_schema=False)
        async def ib_demo() -> FileResponse:
            return FileResponse(IB_DEMO_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    dist = s.frontend_dist
    if s.serve_frontend and (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        async def root() -> RedirectResponse:
            return RedirectResponse("/miniapp")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:
            if path.startswith("api/"):
                raise StarletteHTTPException(404, "Не найдено")
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
