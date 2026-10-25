# Локальный запуск без Docker (Windows PowerShell): venv, зависимости, миграции, демо-данные, сборка Mini App, сервер.
# Использование:  powershell -ExecutionPolicy Bypass -File scripts\run-local.ps1 [-Reset]
param([switch]$Reset)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# Короткий путь к venv: бинарные модули Python не грузятся из слишком длинных путей Windows
$venv = if ($env:PERSONALIZER_VENV) { $env:PERSONALIZER_VENV } else { Join-Path $env:USERPROFILE ".venvs\personalizer" }

if (-not (Test-Path "$venv\Scripts\python.exe")) {
  Write-Host "Создаю окружение Python в $venv"
  py -3 -m venv $venv
}
& "$venv\Scripts\python.exe" -m pip install -q -r "$root\backend\requirements.txt"

Push-Location "$root\frontend"
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
npm run build
Pop-Location

Push-Location "$root\backend"
& "$venv\Scripts\python.exe" -m alembic upgrade head
if ($Reset) { & "$venv\Scripts\python.exe" -m app.seed --reset } else { & "$venv\Scripts\python.exe" -m app.seed }
Write-Host "Откройте http://127.0.0.1:8000/miniapp  (API: http://127.0.0.1:8000/api/docs)"
& "$venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Pop-Location
