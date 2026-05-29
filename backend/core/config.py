"""
Uygulama konfigürasyonu.

Tüm ayarlar .env dosyasından okunur. pydantic-settings
kullanılarak type-safe ve validasyonlu config sağlanır.

Kullanım:
    from core.config import settings
    print(settings.APP_NAME)
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    """
    Merkezi konfigürasyon sınıfı.
    Tüm environment variable'lar burada tanımlanır.
    """

    # ── App ──────────────────────────────────────────
    APP_NAME: str = "AI Code Reviewer"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # ── MongoDB Atlas ────────────────────────────────
    MONGODB_URI: str = "mongodb+srv://user:pass@cluster.mongodb.net/"
    MONGODB_DB_NAME: str = "ai_code_reviewer"

    # ── JWT ──────────────────────────────────────────
    JWT_SECRET_KEY: str = "CHANGE-ME-super-secret-key"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ── CORS ─────────────────────────────────────────
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]

    # ── Domain ───────────────────────────────────────
    BASE_DOMAIN: str = "localhost"

    # ── Rate Limiting ────────────────────────────────
    RATE_LIMIT_DEFAULT: str = "100/minute"
    RATE_LIMIT_AUTH: str = "5/minute"

    # ── Redis (ileride rate limiting + JWT blacklist) ─
    REDIS_URL: str = "redis://localhost:6379/0"
    USE_REDIS: bool = False

    # ── Google AI Studio (Model & Embedding) ─────────
    GOOGLE_API_KEY: str = ""
    AI_MODEL: str = "gemini-1.5-pro-latest"
    EMBEDDING_MODEL: str = "text-embedding-004"

    # ── OpenRouter (Alternative AI Provider) ───────
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    # â”€â”€ OpenAI (AI_PROVIDER=openai) â”€â”€â”€â”€â”€â”€â”€
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    # AI_PROVIDER: "google" | "openrouter" | "openai"
    AI_PROVIDER: str = "google"

    # ── Qdrant ───────────────────────────────────────
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333

    # ── Kubernetes ───────────────────────────────────
    K8S_IN_CLUSTER: bool = False
    K8S_NAMESPACE_PREFIX: str = "project-"
    # Ingress controller class name (Minikube ingress addon uses "nginx")
    K8S_INGRESS_CLASS: str = "nginx"

    # ── Container Kapasite Yönetimi ──────────────────
    MAX_ACTIVE_PODS: int = 12           # Cluster geneli aktif pod limiti
    MAX_PODS_PER_USER: int = 0          # 0 = sınırsız (ileride aktif edilecek)
    IDLE_TIMEOUT_MINUTES: int = 15      # Idle pod auto-stop süresi

    # ── Pod Resource Limitleri ───────────────────────
    # Ana container (kullanıcı projesi)
    POD_CPU_REQUEST: str = "200m"
    POD_CPU_LIMIT: str = "500m"
    POD_MEMORY_REQUEST: str = "256Mi"
    POD_MEMORY_LIMIT: str = "512Mi"
    # Sidecar container (dosya/komut API'si)
    SIDECAR_CPU_REQUEST: str = "100m"
    SIDECAR_CPU_LIMIT: str = "200m"
    SIDECAR_MEMORY_REQUEST: str = "64Mi"
    SIDECAR_MEMORY_LIMIT: str = "128Mi"

    # ── Sidecar API ──────────────────────────────────
    SIDECAR_PORT: int = 8080
    SIDECAR_TIMEOUT: int = 30  # HTTP istek timeout (saniye)

    # ── GitHub ───────────────────────────────────────
    GITHUB_CLONE_TIMEOUT: int = 120             # saniye
    GITHUB_MAX_FILE_SIZE: int = 1_048_576        # 1MB (dosya başına)
    GITHUB_EXCLUDE_DIRS: list[str] = [
        "node_modules", ".git", "__pycache__", ".venv",
        "venv", "dist", "build", ".next", ".cache",
        ".tox", ".mypy_cache", ".pytest_cache",
    ]

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


# Singleton — tüm modüller bu instance'ı kullanır
settings = Settings()
