#!/usr/bin/env sh
# Локальный запуск без Docker (macOS / Linux): venv, зависимости, миграции, демо-данные, сборка Mini App, сервер.
# Использование:  sh scripts/run-local.sh [--reset]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${PERSONALIZER_VENV:-$ROOT/backend/.venv}"

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install -q -r "$ROOT/backend/requirements.txt"

(cd "$ROOT/frontend" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build)

cd "$ROOT/backend"
"$VENV/bin/python" -m alembic upgrade head
if [ "$1" = "--reset" ]; then "$VENV/bin/python" -m app.seed --reset; else "$VENV/bin/python" -m app.seed; fi
echo "Откройте http://127.0.0.1:8000/miniapp  (API: http://127.0.0.1:8000/api/docs)"
exec "$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
