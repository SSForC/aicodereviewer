#!/usr/bin/env bash
set -euo pipefail

echo "Checking prerequisites..."
command -v minikube >/dev/null 2>&1 || { echo "minikube not found. Install: sudo pacman -S minikube" >&2; exit 1; }
command -v kubectl  >/dev/null 2>&1 || { echo "kubectl not found. Install: sudo pacman -S kubectl"  >&2; exit 1; }

echo "Starting minikube (driver=docker)..."
minikube start --driver=docker

echo "Enabling ingress addon..."
minikube addons enable ingress

cat <<'EOF'

Next step (IMPORTANT): run this in a separate terminal and keep it open:
  minikube tunnel

Verify cluster:
  kubectl cluster-info
  kubectl get pods -A
EOF