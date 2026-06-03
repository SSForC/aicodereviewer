#!/usr/bin/env bash
set -euo pipefail

# script konumundan repo köküne çık (PSScriptRoot karşılığı)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
SIDECAR_DIR="$ROOT/backend/sidecar"

command -v minikube >/dev/null 2>&1 || { echo "minikube not found." >&2; exit 1; }

echo "Building sidecar image into minikube image store..."
cd "$ROOT"
minikube image build -t aicodereviewer-sidecar:latest "$SIDECAR_DIR"

echo "Done. You can now start a project pod from the UI."