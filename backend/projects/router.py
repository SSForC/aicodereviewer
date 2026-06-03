"""
Projects modülü — API endpoint'leri.

Tüm endpoint'ler /api/v1/projects prefix'i altında çalışır.

Endpoint'ler:
  POST   /              → Yeni proje oluştur
  GET    /              → Projelerimi listele
  GET    /{id}          → Proje detayı
  PATCH  /{id}          → Proje adı güncelle
  DELETE /{id}          → Projeyi sil
  POST   /{id}/start    → Container başlat
  POST   /{id}/stop     → Container durdur
"""

from fastapi import APIRouter, Depends
import structlog

from auth.dependencies import get_current_user
from auth.models import TokenPayload
from core.database import get_database
from projects.models import (
    CreateProjectRequest,
    ProjectListResponse,
    ProjectResponse,
    UpdateProjectRequest,
)
from projects.service import (
    create_project,
    delete_project,
    get_project,
    list_user_projects,
    start_project,
    stop_project,
    update_project,
)

logger = structlog.get_logger(__name__)

router = APIRouter()


# ── POST / ───────────────────────────────────────────────


@router.post(
    "/",
    response_model=ProjectResponse,
    status_code=201,
    summary="Yeni proje oluştur",
    description=(
        "Yeni bir proje kaydı oluşturur (sadece MongoDB). "
        "Container başlatmak için /start endpoint'ini kullanın."
    ),
)
async def create_project_endpoint(
    data: CreateProjectRequest,
    current_user: TokenPayload = Depends(get_current_user),
) -> ProjectResponse:
    """Yeni proje oluştur (sadece DB kaydı)."""
    db = get_database()

    project = await create_project(db, current_user.sub, data)

    logger.info(
        "create_project_endpoint",
        project_id=project.id,
        user_id=current_user.sub,
    )
    return project


# ── GET / ────────────────────────────────────────────────


@router.get(
    "/",
    response_model=ProjectListResponse,
    summary="Projelerimi listele",
    description="Giriş yapan kullanıcının tüm projelerini listeler.",
)
async def list_projects_endpoint(
    current_user: TokenPayload = Depends(get_current_user),
) -> ProjectListResponse:
    """Kullanıcının projelerini listele."""
    db = get_database()
    return await list_user_projects(db, current_user.sub)


# ── GET /{id} ────────────────────────────────────────────


@router.get(
    "/{project_id}",
    response_model=ProjectResponse,
    summary="Proje detayı",
    description="Belirtilen projenin detaylarını döndürür.",
)
async def get_project_endpoint(
    project_id: str,
    current_user: TokenPayload = Depends(get_current_user),
) -> ProjectResponse:
    """Proje detayını getir."""
    db = get_database()
    return await get_project(db, project_id, current_user.sub)


# ── PATCH /{id} ──────────────────────────────────────────


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    summary="Proje adı güncelle",
    description="Projenin adını günceller.",
)
async def update_project_endpoint(
    project_id: str,
    data: UpdateProjectRequest,
    current_user: TokenPayload = Depends(get_current_user),
) -> ProjectResponse:
    """Proje adını güncelle."""
    db = get_database()
    return await update_project(db, project_id, current_user.sub, data)


# ── DELETE /{id} ─────────────────────────────────────────


@router.delete(
    "/{project_id}",
    status_code=204,
    summary="Projeyi sil",
    description=(
        "Projeyi siler. Eğer container çalışıyorsa önce durdurulur. "
        "İlişkili tüm veriler (agent sessions, file summaries) temizlenir."
    ),
)
async def delete_project_endpoint(
    project_id: str,
    current_user: TokenPayload = Depends(get_current_user),
) -> None:
    """Projeyi ve ilişkili tüm verileri sil."""
    db = get_database()
    await delete_project(db, project_id, current_user.sub)

    logger.info(
        "delete_project_endpoint",
        project_id=project_id,
        user_id=current_user.sub,
    )


# ── POST /{id}/start ────────────────────────────────────


@router.post(
    "/{project_id}/start",
    response_model=ProjectResponse,
    summary="Container başlat",
    description=(
        "Projenin Kubernetes container'ını başlatır. "
        "Proje 'created' veya 'stopped' durumunda olmalıdır. "
        "Cluster kapasitesi kontrol edilir."
    ),
)
async def start_project_endpoint(
    project_id: str,
    current_user: TokenPayload = Depends(get_current_user),
) -> ProjectResponse:
    """Proje container'ını başlat."""
    db = get_database()

    project = await start_project(db, project_id, current_user.sub)

    logger.info(
        "start_project_endpoint",
        project_id=project_id,
        preview_url=project.preview_url,
    )
    return project


# ── POST /{id}/stop ──────────────────────────────────────


@router.post(
    "/{project_id}/stop",
    response_model=ProjectResponse,
    summary="Container durdur",
    description=(
        "Projenin Kubernetes container'ını durdurur. "
        "Pod silinir ama proje kaydı kalır. "
        "Tekrar başlatılabilir."
    ),
)
async def stop_project_endpoint(
    project_id: str,
    current_user: TokenPayload = Depends(get_current_user),
) -> ProjectResponse:
    """Proje container'ını durdur."""
    db = get_database()

    project = await stop_project(db, project_id, current_user.sub)

    logger.info(
        "stop_project_endpoint",
        project_id=project_id,
    )
    return project

# ── DOSYA VE SIDECAR (SANDBOX) KÖPRÜSÜ ──

from sandbox.client import SandboxClient
from pydantic import BaseModel

class WriteFileRequest(BaseModel):
    path: str
    content: str

class ExecRequest(BaseModel):
    command: str
    timeout: int = 30


class CreateDirectoryRequest(BaseModel):
    path: str

@router.get("/{project_id}/files")
async def list_project_files(
    project_id: str,
    path: str = "/",
    current_user: TokenPayload = Depends(get_current_user),
):
    client = SandboxClient(project_id)
    return await client.list_files(path)

@router.get("/{project_id}/files/read")
async def read_project_file(
    project_id: str,
    path: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    client = SandboxClient(project_id)
    return await client.read_file(path)

@router.post("/{project_id}/files/write")
async def write_project_file(
    project_id: str,
    data: WriteFileRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    client = SandboxClient(project_id)
    return await client.write_file(data.path, data.content)

@router.delete("/{project_id}/files/delete")
async def delete_project_file(
    project_id: str,
    path: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    client = SandboxClient(project_id)
    return await client.delete_file(path)

@router.post("/{project_id}/exec")
async def exec_project_command(
    project_id: str,
    data: ExecRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    client = SandboxClient(project_id)
    return await client.exec_command(data.command, data.timeout)


@router.post("/{project_id}/directories/create")
async def create_project_directory(
    project_id: str,
    data: CreateDirectoryRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    client = SandboxClient(project_id)
    return await client.create_directory(data.path)


# -- DOSYA 0^LEMLER0 (SIDECAR PROXY) --

