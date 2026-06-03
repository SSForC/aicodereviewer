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

### Gerekenler

- Docker Desktop açık olmalı.
- Node.js/npm kurulu olmalı.
- Backend için proje içindeki `.venv` kullanılmalı.

### 1) Lokal stack'i sırayla çalıştır

Repo kökünde 3 ayrı PowerShell aç:

**Terminal 1**
```powershell
docker compose up -d mongo
```

**Terminal 2**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```

**Terminal 3**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-frontend.ps1
```

Frontend:

- http://127.0.0.1:5173

### 2) Minikube kur ve ayağa kaldır

```powershell
winget install Kubernetes.minikube
powershell -ExecutionPolicy Bypass -File .\scripts\setup-minikube.ps1
```

Ayrı bir terminalde:

```powershell
minikube tunnel
```

Sidecar imajını Minikube içine build et:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-sidecar-minikube.ps1
```

### 3) Cluster kontrolü

```powershell
kubectl config get-contexts
kubectl cluster-info
kubectl get pods -A
```

## AI Yapılandırması

`backend/.env` içinde bir provider seç:

- **OpenAI:** `AI_PROVIDER=openai`, `OPENAI_API_KEY=...`, `AI_MODEL=...`
- **OpenRouter:** `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY=...`, `AI_MODEL=...`
- **Google:** `AI_PROVIDER=google`, `GOOGLE_API_KEY=...`, `AI_MODEL=...`

Not:
- AI anahtarlarını repoya yazma.
- Key değiştiyse backend'i yeniden başlat.

## Proje Yapısı

- `frontend/` — React/Vite kullanıcı arayüzü
- `backend/` — FastAPI API, agent ve sandbox köprüsü
- `backend/sidecar/` — Pod içi dosya/komut servisleri
- `scripts/` — backend, frontend ve Minikube yardımcı scriptleri

