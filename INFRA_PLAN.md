# Infrastructure Plan

Bu proje arkadasindan geldigi haliyle dis baglantilari kopmus durumda. Tekrar calisir hale getirmek icin sirali plan:

## Faz 1 - Lokal cekirdek

Durum: tamamlandi.

- Frontend build aliyor.
- Backend dependency kurulumu yapildi.
- Lokal MongoDB Docker Compose ile tanimlandi.
- Auth ve proje olusturma smoke testi basarili.

## Faz 2 - Lokal kullanim

Gerekenler:

- Docker Desktop acik olmali.
- MongoDB container calismali.
- Backend ayri terminalde calismali.
- Frontend ayri terminalde calismali.

Komutlar:

```powershell
docker compose up -d mongo
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-frontend.ps1
```

## Faz 3 - AI provider

Agent endpointini kullanmak icin bir AI provider secilecek.

Secenek A:

- Google AI Studio key
- `GOOGLE_API_KEY=...`
- `AI_PROVIDER=google`
- `AI_MODEL=gemini-1.5-pro-latest` veya guncel desteklenen model

Secenek B:

- OpenRouter key
- `OPENROUTER_API_KEY=...`
- `AI_PROVIDER=openrouter`
- `AI_MODEL=<openrouter model id>`

## Faz 4 - Kubernetes sandbox

Projenin `start_project`, `exec`, dosya okuma/yazma ve preview ozellikleri Kubernetes/sidecar bekliyor.

Gerekenler:

- Docker Desktop Kubernetes veya Minikube (bu repo icin Minikube tavsiye: ingress + tunnel akisi daha net).
- Sidecar image build:

```powershell
docker build -t aicodereviewer-sidecar:latest .\backend\sidecar
```

Minikube kullaniliyorsa (tavsiye):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-minikube.ps1
# ayri terminalde acik kalmali:
minikube tunnel
powershell -ExecutionPolicy Bypass -File .\scripts\build-sidecar-minikube.ps1
```

- Kubernetes client config backend tarafindan gorulebilmeli.
- `K8S_IN_CLUSTER=false` lokal gelistirme icin kalabilir.
- `BASE_DOMAIN=localhost` yerine ingress senaryosuna uygun domain/host ayari gerekebilir.

Not: Bu fazda kodda da duzeltme gerekecek. Su an servis/port yorumlari ve sidecar erisim modeli tam guvenilir degil.

## Faz 5 - RAG/Qdrant

README Qdrant anlatiyor ama kodda RAG kisimlari kismen pasif.

Gerekenler:

- Qdrant container/service.
- Indexer/retriever akisi aktif edilmeli.
- Agent context builder Qdrant sonucunu gercekten kullanmali.

## Faz 6 - Urunlestirme

- README encoding duzeltilecek.
- Eksik deployment scriptleri tamamlanacak.
- Log seviyesi sade hale getirilecek.
- Test scriptleri ve CI eklenecek.
- Security review yapilacak.
