# revu — AI destekli izole kod workspace'i

`revu`, tarayıcıdan kod yazma, düzenleme, çalıştırma ve önizleme akışını tek ekranda birleştiren AI destekli bir geliştirme platformudur. Her proje Kubernetes içinde ayrı namespace/pod olarak çalışır; backend dosya işlemleri ve komut çalıştırmayı sidecar üzerinden yönetir, AI ajanı da bu güvenli sandbox'a bağlanır.

## Kısa Özet

- Kullanıcı proje açar, pod başlatır ve dosya ağacını görür.
- AI, dosyaları okuyup yazar; gerektiğinde komut çalıştırır ve sonucu terminal/log paneline düşürür.
- Kullanıcı isterse kodu elle düzenler, kaydeder veya bilgisayarına indirir.
- HTML dosyaları için hızlı önizleme, Python dosyaları için çalıştırma akışı vardır.
- GitHub reposu import edilebilir; profil menüsü ve dashboard geçişleri de hazırdır.

## Temel Özellikler

- **Workspace düzenleyici:** Dosya ağacı, kod editörü, agent sohbeti ve terminal/log alanı tek sayfada.
- **Manuel düzenleme:** Dosyayı doğrudan editörde değiştirme, `Kaydet` ile pod'a yazma, `İndir` ile bilgisayara alma.
- **AI ajanı:** Dosya okuma/yazma, klasör oluşturma, komut çalıştırma ve özetleme adımlarını yönetir.
- **Run akışı:** Python dosyalarını `python <dosya>` ile çalıştırma; diğer runtime'lar için uygun komut önerileri.
- **Önizleme:** `index.html` ve benzeri statik sayfaları preview link'i ile açma.
- **GitHub import:** Public/private repo import akışı.
- **Profil menüsü:** Logo ile dashboard'a dönüş, profil sayfası ve çıkış yap.

## Nasıl Çalışır

1. Frontend, proje ve workspace durumunu backend'den çeker.
2. Backend, Kubernetes'te ilgili proje için namespace/pod oluşturur.
3. Sidecar, `/workspace` altında dosya okuma/yazma ve komut çalıştırma sağlar.
4. AI ajanı, plan/action/observer akışıyla işi parçalara ayırır ve sonucu kaydeder.

## Lokal Çalıştırma

- **Frontend:** React 19.1, Vite, React Router DOM, Özel CSS (CSS variables tabanlı)
- **Backend:** Python 3.12, FastAPI, Uvicorn, LangGraph, LangChain, Pydantic v2
- **Veritabanı:** MongoDB (Üretimde Atlas, yerelde Docker Compose üzerinden — Motor async driver)
- **Vektör Veritabanı:** Qdrant (RAG işlemleri için)
- **Yapay Zeka:** Google Gemini 1.5 Pro & gemini-embedding-2
- **Altyapı:** Kubernetes (Minikube), Docker, Docker Compose, Nginx

## ✅ Ön Gereksinimler

Platformu yerelde ayağa kaldırmak için aşağıdaki araçların kurulu olması gerekir:

| Araç | Windows | Linux / Arch |
| --- | --- | --- |
| Docker | Docker Desktop | `sudo pacman -S docker docker-compose` + `sudo systemctl enable --now docker` |
| Minikube | `winget install Kubernetes.minikube` | `sudo pacman -S minikube` |
| kubectl | `winget install Kubernetes.kubectl` | `sudo pacman -S kubectl` |
| Node.js + npm | [nodejs.org](https://nodejs.org) | `sudo pacman -S nodejs npm` |
| Python 3.12 | [python.org](https://python.org) | `sudo pacman -S python` |
| jq (smoke test için) | `winget install jqlang.jq` | `sudo pacman -S jq` |

> **Linux notu:** Minikube'ü `docker` sürücüsüyle çalıştırmak için kullanıcınızın `docker` grubunda olması gerekir:
> ```bash
> sudo usermod -aG docker $USER   # sonra logout/login (ya da: newgrp docker)
> ```

## ⚙️ Kurulum ve Yapılandırma

### 1) Lokal stack'i sırayla çalıştır

```bash
cp .env.example .env
# .env dosyasını gerekli bilgilerle doldurun
```

### Backend bağımlılıkları (sanal ortam)

Linux ve Windows venv'leri taşınabilir değildir; her platformda ayrı oluşturun.

**Windows**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

**Linux / Arch**
```bash
cd backend
python -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

## 🧩 Scriptler

Tüm yardımcı scriptler repo kökündeki `scripts/` klasöründedir. Her script hem `.ps1` (Windows) hem `.sh` (Linux) sürümüyle gelir; isimler birebir eşleşir.

| Görev | Windows | Linux / Arch |
| --- | --- | --- |
| Minikube cluster + ingress kurulumu | `scripts\setup-minikube.ps1` | `scripts/setup-minikube.sh` |
| Sidecar imajını Minikube'e build et | `scripts\build-sidecar-minikube.ps1` | `scripts/build-sidecar-minikube.sh` |
| Backend'i başlat | `scripts\start-backend.ps1` | `scripts/start-backend.sh` |
| Frontend'i başlat | `scripts\start-frontend.ps1` | `scripts/start-frontend.sh` |
| Tüm yerel stack (Mongo + backend + frontend) | `scripts\start-local.ps1` | `scripts/start-local.sh` |
| Uçtan uca smoke test | `scripts\smoke-local.ps1` | `scripts/smoke-local.sh` |

> **Linux'ta ilk kez:** `.sh` dosyalarına çalıştırma izni verin:
> ```bash
> chmod +x scripts/*.sh
> ```

## 🚀 Çalıştırma

### Yöntem 1 — Yerel Stack (Mongo + Backend + Frontend)

Kubernetes/AI ajanı olmadan, çekirdek uygulamayı (auth, dashboard, proje CRUD) çalıştırmak için en hızlı yol. MongoDB Docker Compose üzerinden lokal olarak ayağa kalkar.

**Windows**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

**Linux / Arch**
```bash
./scripts/start-local.sh
```

Ardından:
- Frontend: <http://127.0.0.1:5173>
- Backend: <http://127.0.0.1:8000>
- Health: <http://127.0.0.1:8000/health>

> Linux sürümü Ctrl+C ile backend ve frontend'i birlikte durdurur. Mongo arka planda kalır; durdurmak için: `docker compose down`

### Yöntem 2 — Minikube ile Tam Kurulum (Sandbox + AI Ajanı)

İzole pod'lar ve AI ajanı dahil tüm platformu çalıştırmak için.

**1. Cluster'ı başlat ve ingress'i aç**

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-minikube.ps1
```
Linux / Arch:
```bash
./scripts/setup-minikube.sh
```

**2. `minikube tunnel`'ı ayrı bir terminalde açık bırakın** (ingress IP'lerini localhost'a yönlendirir; Linux'ta `sudo` şifresi sorabilir):
```bash
minikube tunnel
```

**3. Sidecar imajını Minikube ortamına build edin**

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-sidecar-minikube.ps1
```
Linux / Arch:
```bash
./scripts/build-sidecar-minikube.sh
```

**4. Backend'i başlatın** (Kubeconfig otomatik olarak repo-local `.kubeconfig` dosyasına export edilip entegre edilir)

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```
Linux / Arch:
```bash
./scripts/start-backend.sh
```

**5. Frontend'i başlatın** (ayrı terminal)

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-frontend.ps1
```
Linux / Arch:
```bash
./scripts/start-frontend.sh
```

**Cluster'ın hazır olduğunu doğrulayın:**
```bash
kubectl config get-contexts
kubectl cluster-info
kubectl get pods -A
```

### Yöntem 3 — Üretim Ortamı (Docker Compose)

```bash
cp .env.example .env
# .env dosyasını üretim parametreleriyle doldurun
docker-compose up -d
docker-compose logs -f backend
```

## 🔥 Smoke Test

Backend ayaktayken auth + proje oluşturma akışını uçtan uca doğrular.

**Windows**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-local.ps1
```

**Linux / Arch** (`jq` gerektirir)
```bash
./scripts/smoke-local.sh
```

## 🪟 Cross-Platform Not (.gitattributes)

Scriptlerin Windows ve Linux arasında satır sonu (`CRLF`/`LF`) sorunları yaşamaması için repo kökünde bir `.gitattributes` dosyası bulunmalıdır:

```gitattributes
*.sh  text eol=lf
*.ps1 text eol=crlf
```

Bu, `.sh` dosyalarının her zaman `LF` ile checkout edilmesini sağlar ve Linux'ta `bad interpreter: ...^M` hatasını önler. `.sh` dosyalarının executable bit'ini Git'e işlemek için bir kez:

```bash
git update-index --chmod=+x scripts/*.sh
```

## 🏗 Mimari Detaylar

1. **Nginx Reverse Proxy:** HTTP trafiğini HTTPS'e yönlendirir, WebSocket (`Upgrade`) isteklerini yönetir ve IP bazlı aşımlar için Rate Limiting uygular.
2. **Kubernetes Pod Yapısı:**
   - **App Container:** Boşta bekleyen (idle loop) ve kullanıcının uygulamasının barındırıldığı asıl ortamdır.
   - **Sidecar Container (FastAPI):** `/workspace` (emptyDir) volume'unu App Container ile paylaşır. AI ajanının dosya okuma/yazma ve izole komut çalıştırma (`/exec`) isteklerini güvenlik kuralları (Path traversal vb.) çerçevesinde yönetir.
3. **AI ve RAG İş Akışı:** Qdrant üzerinde tutulan proje dosyaları anlamsal olarak aranır (Semantic Search). En uygun kod parçaları Gemini promptuna Context olarak enjekte edilip ajana sunulur, böylelikle büyük projelerde dahi ajan yüksek doğrulukla çalışır.

- `frontend/` — React/Vite kullanıcı arayüzü
- `backend/` — FastAPI API, agent ve sandbox köprüsü
- `backend/sidecar/` — Pod içi dosya/komut servisleri
- `scripts/` — backend, frontend ve Minikube yardımcı scriptleri

- Hatalar (bug) ve özellik istekleri (feature requests) için lütfen "Issues" kısmını kullanın.
- Büyük ve yapısal değişiklikler yapmadan önce sistemin mevcut işleyişini bozmamak adına tartışmak için bir "Issue" açmanız rica olunur.
