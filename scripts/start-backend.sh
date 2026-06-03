#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND="$ROOT/backend"
cd "$BACKEND"

# Python kubernetes client'ın bayat config'e takılmaması için
# her başlangıçta repo-local kubeconfig'i tazele.
KUBECONFIG_PATH="$BACKEND/.kubeconfig"
{
  if command -v minikube >/dev/null 2>&1; then
    minikube update-context >/dev/null 2>&1 || true
  fi
  if command -v kubectl >/dev/null 2>&1; then
    kubectl config view --raw --minify --flatten > "$KUBECONFIG_PATH"
    export KUBECONFIG="$KUBECONFIG_PATH"
  fi
} || true   # export başarısız olsa da backend ayağa kalksın

exec ./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000