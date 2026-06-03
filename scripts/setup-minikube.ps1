$ErrorActionPreference = "Stop"

Write-Host "Checking prerequisites..."
if (-not (Get-Command minikube -ErrorAction SilentlyContinue)) {
  throw "minikube not found. Install it first (example: winget install Kubernetes.minikube)."
}
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
  throw "kubectl not found. Install it first (example: winget install Kubernetes.kubectl)."
}

Write-Host "Starting minikube (driver=docker)..."
minikube start --driver=docker

Write-Host "Enabling ingress addon..."
minikube addons enable ingress

Write-Host ""
Write-Host "Next step (IMPORTANT): run this in a separate terminal and keep it open:"
Write-Host "  minikube tunnel"
Write-Host ""
Write-Host "Verify cluster:"
Write-Host "  kubectl cluster-info"
Write-Host "  kubectl get pods -A"