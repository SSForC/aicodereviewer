import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel

app = FastAPI(title="AI Code Reviewer Sidecar API")

# Çalışma alanı k8s içinde EmptyDir üzerinden sağlanır
WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", "/workspace")


# Modeller
class WriteFileRequest(BaseModel):
    path: str
    content: str


class DeleteFileRequest(BaseModel):
    path: str


class CreateDirectoryRequest(BaseModel):
    path: str


class ExecRequest(BaseModel):
    command: str
    timeout: int = 30


# Güvenlik Listesi
BLOCKED_COMMANDS = [
    "rm -rf /",
    "curl",
    "wget",
    "apt",
    "apk",
    "sudo",
    "chmod 777",
    "nc",        # netcat
    "ssh",
]


def resolve_path(sandbox_path: str) -> Path:
    """Kullanıcının verdiği relative path'i workspace içerisine map eder ve doğrulamasını yapar."""
    sandbox_path = sandbox_path.lstrip("/")
    full_path = Path(WORKSPACE_DIR) / sandbox_path
    
    # Path Traversal kontrolü
    try:
        full_path.resolve().relative_to(Path(WORKSPACE_DIR).resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Workspace dışına çıkılamaz.")
        
    return full_path


@app.get("/", response_class=HTMLResponse)
async def preview_root() -> HTMLResponse:
    """Kök URL'de workspace/index.html servis et."""
    index_file = Path(WORKSPACE_DIR) / "index.html"
    if not index_file.exists() or not index_file.is_file():
        raise HTTPException(status_code=404, detail="index.html bulunamadı")
    try:
        content = index_file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="index.html UTF-8 olmalı")
    return HTMLResponse(content=content)


@app.get("/files")
async def list_files(path: str = "/") -> Dict:
    target_dir = resolve_path(path)
    
    if not target_dir.exists() or not target_dir.is_dir():
        raise HTTPException(status_code=404, detail="Klasör bulunamadı")
        
    files = []
    for item in target_dir.iterdir():
        files.append({
            "name": item.name,
            "is_dir": item.is_dir(),
            "size": item.stat().st_size if item.is_file() else 0
        })
        
    return {"path": path, "files": sorted(files, key=lambda x: (not x["is_dir"], x["name"]))}


@app.get("/files/read")
async def read_file(path: str) -> Dict:
    target_file = resolve_path(path)
    
    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        
    try:
        content = target_file.read_text(encoding="utf-8")
        return {"path": path, "content": content, "size": target_file.stat().st_size}
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Sadece metin dosyaları okunabilir")


@app.post("/files/write")
async def write_file(req: WriteFileRequest) -> Dict:
    target_file = resolve_path(req.path)
    
    # Klasörleri oluştur
    target_file.parent.mkdir(parents=True, exist_ok=True)
    
    target_file.write_text(req.content, encoding="utf-8")
    return {"success": True, "path": req.path}


@app.post("/directories/create")
async def create_directory(req: CreateDirectoryRequest) -> Dict:
    target_dir = resolve_path(req.path)
    target_dir.mkdir(parents=True, exist_ok=True)
    return {"success": True, "path": req.path}


@app.delete("/files/delete")
async def delete_file(path: str = Body(..., embed=True)) -> Dict:
    target_path = resolve_path(path)
    
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Dosya veya klasör bulunamadı")
        
    if target_path.is_file():
        target_path.unlink()
    else:
        shutil.rmtree(target_path)
        
    return {"success": True, "path": path}


@app.post("/exec")
async def exec_command(req: ExecRequest) -> Dict:
    # 1. Güvenlik Kontrolü
    cmd_lower = req.command.lower()
    for blocked in BLOCKED_COMMANDS:
        if blocked in cmd_lower:
            raise HTTPException(status_code=403, detail=f"Güvenlik ihlali: '{blocked}' komutuna izin verilmiyor.")

    # 2. Asenkron Çalıştırma
    try:
        # Popen ile shell modunda çalıştır, workspace'de izole et
        process = await asyncio.create_subprocess_shell(
            req.command,
            cwd=WORKSPACE_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=req.timeout,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise HTTPException(
                status_code=408,
                detail=f"Komut zaman aşımına uğradtı ({req.timeout}s): {req.command[:100]}",
            )

        return {
            "command": req.command,
            "exit_code": process.returncode,
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/logs")
async def get_logs(lines: int = 50) -> Dict:
    """Loglar için uygulamamız K8s emptyDir kullanırken
       /workspace/run.log şeklinde çalıştırılıyorsa oradan okunabilir."""
    log_file = Path(WORKSPACE_DIR) / "run.log"
    
    if not log_file.exists():
        return {"logs": "Hiçbir log bulunamadı (run.log yok)", "lines": lines}
        
    try:
        # Son 'lines' satırını okumak için tail kullanımı:
        process = await asyncio.create_subprocess_exec(
            "tail", f"-n{lines}", str(log_file),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await process.communicate()
        return {"logs": stdout.decode("utf-8", errors="replace"), "lines": lines}
    except Exception as e:
        return {"logs": f"Log okuma hatası: {str(e)}", "lines": lines}


@app.post("/restart")
async def restart_service() -> Dict:
    """
    Ana uygulamanın yeniden başlaması.
    Hot reload (uvicorn --reload veya nodemon) devredeyse buna pek gerek kalmaz, 
    ancak force-restart gerekirse diye shareProcessNamespace özelliği kullanılarak
    node veya python sürecini öldürebiliriz. Denediği ilk eşleşeni kill eder.
    K8s pod'u otomatik kaldıracaktır.
    """
    try:
        # Node processini bul ve öldür
        node_process = await asyncio.create_subprocess_exec("pkill", "node")
        await node_process.wait()
        
        # Python processini bul ve öldür (kendisi hariç)
        # Sadece uvicorn olmayanları veya spesifik python komutlarını hedefleyebiliriz
        # ama pkill python dersek sidecar etkilenmez çünkü sidecar'ın proses adı uvicorn
        py_process = await asyncio.create_subprocess_exec("pkill", "python")
        await py_process.wait()
        
        return {"success": True, "message": "Yeniden başlatma sinyali gönderildi."}
    except Exception as e:
        return {"success": False, "message": f"Hata: {str(e)}"}


@app.get("/{path:path}")
async def serve_static(path: str) -> FileResponse:
    """Workspace içindeki herhangi bir statik dosyayı servis et.

    /files, /exec gibi API route'ları daha spesifik olduğu için önce eşleşir;
    geri kalan tüm yollar buraya düşer (CSS, JS, görsel vb.).
    """
    target = resolve_path(path)

    if target.is_file():
        return FileResponse(target)

    if target.is_dir():
        index = target / "index.html"
        if index.is_file():
            return FileResponse(index)

    raise HTTPException(status_code=404, detail=f"Dosya bulunamadı: {path}")
