$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"

Set-Location $backend

# Ensure Python Kubernetes client can load kubeconfig.
# In some Windows setups, kubectl works but the Python client can't find/parse the default kubeconfig path.
# We refresh a repo-local kubeconfig on every backend start so Minikube IP/port changes do not leave stale configs behind.
$kubeconfigPath = Join-Path $backend ".kubeconfig"
try {
  if (Get-Command minikube -ErrorAction SilentlyContinue) {
    try {
      minikube update-context | Out-Null
    } catch {
      # Keep going; the next export step may still succeed.
    }
  }

  if (Get-Command kubectl -ErrorAction SilentlyContinue) {
    kubectl config view --raw --minify --flatten | Out-File -FilePath $kubeconfigPath -Encoding utf8
    if (Test-Path $kubeconfigPath) {
      $env:KUBECONFIG = $kubeconfigPath
    }
  }
} catch {
  # If kubeconfig export fails, continue starting backend; pod start will still error with a clear message.
}

.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
