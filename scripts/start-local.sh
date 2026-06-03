#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

echo "Starting MongoDB..."
docker compose up -d mongo || {
  echo "Docker Compose failed. 'systemctl status docker' kontrol et ve 'docker' grubunda olduğundan emin ol." >&2
  exit 1
}

pids=()
cleanup() {
  echo ""; echo "Stopping backend & frontend..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

echo "Starting backend on http://127.0.0.1:8000 ..."
( "$SCRIPT_DIR/start-backend.sh" ) & pids+=("$!")

echo "Starting frontend on http://127.0.0.1:5173 ..."
( "$SCRIPT_DIR/start-frontend.sh" ) & pids+=("$!")

cat <<'EOF'

Local stack starting:
  Frontend: http://127.0.0.1:5173
  Backend:  http://127.0.0.1:8000
  Health:   http://127.0.0.1:8000/health

(Ctrl+C ile ikisini birden durdurur. Mongo arka planda kalır: docker compose down)
EOF

wait