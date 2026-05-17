$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sidecarDir = Join-Path $root "backend\\sidecar"

if (-not (Get-Command minikube -ErrorAction SilentlyContinue)) {
  throw "minikube not found. Install it first (example: winget install Kubernetes.minikube)."
}

Write-Host "Building sidecar image into minikube image store..."
Set-Location $root
minikube image build -t aicodereviewer-sidecar:latest $sidecarDir

Write-Host "Done. You can now start a project pod from the UI."

