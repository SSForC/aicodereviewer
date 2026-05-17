$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Write-Host "Starting MongoDB..."
Set-Location $root
docker compose up -d mongo
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose failed. Make sure Docker Desktop is running and your Windows user can access Docker."
}

Write-Host "Starting backend on http://127.0.0.1:8000 ..."
Start-Process `
  -FilePath (Join-Path $root "backend\.venv\Scripts\python.exe") `
  -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory (Join-Path $root "backend") `
  -WindowStyle Hidden

Write-Host "Starting frontend on http://127.0.0.1:5173 ..."
Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList "run", "dev", "--", "--host", "127.0.0.1" `
  -WorkingDirectory (Join-Path $root "frontend") `
  -WindowStyle Hidden

Write-Host ""
Write-Host "Local stack is starting:"
Write-Host "  Frontend: http://127.0.0.1:5173"
Write-Host "  Backend:  http://127.0.0.1:8000"
Write-Host "  Health:   http://127.0.0.1:8000/health"
