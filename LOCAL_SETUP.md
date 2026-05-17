# Local Setup

Bu dokuman projeyi sifirdan lokal calistirmak icin kisa rehberdir.

## Gerekenler

- Docker Desktop acik olmali.
- Node.js/npm kurulu olmali.
- Backend icin proje icinde `.venv` kullanilir.

## Ilk Kurulum

Frontend bagimliliklari:

```powershell
cd frontend
npm ci
```

Backend virtualenv ve bagimliliklar:

```powershell
cd backend
C:\Users\Suleyman\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Calistirma

En guvenilir yontem uc terminal kullanmaktir.

Terminal 1, MongoDB:

```powershell
docker compose up -d mongo
```

Terminal 2, backend:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```

Terminal 3, frontend:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-frontend.ps1
```

Adresler:

- Frontend: http://127.0.0.1:5173
- Backend: http://127.0.0.1:8000
- Health: http://127.0.0.1:8000/health
- API docs: http://127.0.0.1:8000/api/v1/docs

## Smoke Test

Backend calisir durumdayken:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local.ps1
```

Bu test kullanici kaydi, login, `/me` ve proje olusturma akisini kontrol eder.

## Gerekli Gizli Degerler

Simdilik lokal calisma icin API key gerekmez.

AI agent ozelligi icin daha sonra bunlardan biri gerekir:

- `GOOGLE_API_KEY`
- veya `OPENROUTER_API_KEY`

MongoDB Atlas kullanilacaksa `backend/.env` icindeki `MONGODB_URI` Atlas connection string ile degistirilir.

## Siradaki Buyuk Parcalar

1. Kubernetes/Minikube kurulumu.
2. Sidecar Docker image build.
3. Project start/stop endpointlerinin Minikube ile dogrulanmasi.
4. AI provider key eklenmesi.
5. Agent run, file tools ve WebSocket stream testleri.
