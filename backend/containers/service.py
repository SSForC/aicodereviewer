"""
Containers modÃ¼lÃ¼ â€” Kubernetes iÅŸlemleri.

GerÃ§ek Kubernetes Python client entegrasyonu.
"""

import asyncio
import os
from pathlib import Path
from typing import Dict, Optional

import structlog
from kubernetes import client, config
from kubernetes.client.rest import ApiException

from core.config import settings

logger = structlog.get_logger(__name__)


def _k8s_host_looks_unconfigured(host: str | None) -> bool:
    """
    When Kubernetes client config isn't loaded properly, the Python client can
    fall back to http://localhost:80, which causes confusing connection errors.
    Treat that as "not configured" and surface a clear message instead.
    """
    if not host:
        return True

    h = host.strip().lower()
    if h in ("http://localhost", "https://localhost"):
        return True

    # Common fallback: http(s)://localhost:80
    if "localhost" in h and (h.endswith(":80") or ":80/" in h):
        return True

    return False


def _k8s_not_ready_error() -> RuntimeError:
    return RuntimeError(
        "Kubernetes API'ye baglanilamiyor. Pod baslatmak icin lokal Kubernetes (Docker Desktop Kubernetes veya Minikube) calisir durumda olmali "
        "ve kubeconfig yuklu olmali. Kontrol: `kubectl cluster-info` ve `kubectl get ns`. "
        "Sidecar imaji da build edilmeli: `docker build -t aicodereviewer-sidecar:latest backend/sidecar`."
    )

def _load_kube_config() -> None:
    """Load kubeconfig from a reliable local file before falling back."""
    kubeconfig_candidates = [
        os.environ.get("KUBECONFIG"),
        str(Path(__file__).resolve().parents[1] / ".kubeconfig"),
    ]

    last_error: Exception | None = None

    for candidate in kubeconfig_candidates:
        if not candidate:
            continue
        try:
            config.load_kube_config(config_file=candidate)
            logger.info("kubeconfig_loaded", source="file", path=candidate)
            return
        except Exception as exc:
            last_error = exc

    try:
        config.load_kube_config()
        logger.info("kubeconfig_loaded", source="local")
        return
    except Exception as exc:
        last_error = exc

    try:
        config.load_incluster_config()
        logger.info("kubeconfig_loaded", source="incluster")
        return
    except config.ConfigException:
        logger.warning(
            "kubeconfig_not_found",
            error=str(last_error) if last_error else None,
        )


_load_kube_config()

# API client tanÄ±mlarÄ± global bÄ±rakÄ±lÄ±yor, yÃ¼klendikten sonra hata vermezse kullanÄ±lÄ±r.
try:
    core_v1 = client.CoreV1Api()
    apps_v1 = client.AppsV1Api()
    networking_v1 = client.NetworkingV1Api()

    # If the host looks like the default localhost fallback, treat as not ready.
    try:
        cfg = client.Configuration.get_default_copy()
        if _k8s_host_looks_unconfigured(getattr(cfg, "host", None)):
            logger.warning("k8s_config_unconfigured", host=getattr(cfg, "host", None))
            core_v1 = None
            apps_v1 = None
            networking_v1 = None
    except Exception:
        pass
except Exception:
    core_v1 = None
    apps_v1 = None
    networking_v1 = None


async def create_pod(
    project_id: str,
    namespace: str,
) -> dict:
    """
    Proje iÃ§in Kubernetes pod ve yardÄ±mcÄ± objelerini oluÅŸturur.

    - Namespace
    - Deployment (Ana uygulama + Sidecar API)
    - Service
    - Ingress
    """
    logger.info(
        "create_pod_k8s",
        project_id=project_id,
        namespace=namespace,
    )
    
    if not core_v1:
        logger.error("k8s_client_not_initialized")
        raise _k8s_not_ready_error()

    loop = asyncio.get_running_loop()

    def _create_k8s_objects():
        # 1. Namespace oluÅŸtur
        try:
            ns = client.V1Namespace(metadata=client.V1ObjectMeta(name=namespace))
            core_v1.create_namespace(body=ns)
        except ApiException as e:
            if e.status != 409:  # 409 Conflict = already exists
                raise

        # 2. Deployment oluÅŸtur
        deployment_name = f"project-{project_id}"
        
        # Ana uygulamanÄ±n container'i (Ã–rnek olarak Node/Alpine. Projeye gÃ¶re deÄŸiÅŸebilir)
        container_app = client.V1Container(
            name="app",
            image="node:18-alpine",
            command=["sh", "-c"],
            args=["while true; do sleep 30; done;"],  # Ä°Ã§eriÄŸi sidecar dolduracak/Ã§alÄ±ÅŸtÄ±racak
            volume_mounts=[client.V1VolumeMount(name="workspace", mount_path="/workspace")],
            working_dir="/workspace",
            resources=client.V1ResourceRequirements(
                requests={
                    "cpu": settings.POD_CPU_REQUEST,
                    "memory": settings.POD_MEMORY_REQUEST,
                },
                limits={
                    "cpu": settings.POD_CPU_LIMIT,
                    "memory": settings.POD_MEMORY_LIMIT,
                },
            ),
        )

        # Sidecar API
        container_sidecar = client.V1Container(
            name="sidecar",
            image="aicodereviewer-sidecar:latest",  # Dockerfile build alÄ±nmalÄ±
            image_pull_policy="IfNotPresent",
            ports=[client.V1ContainerPort(container_port=8000, name="sidecar-http")],
            volume_mounts=[client.V1VolumeMount(name="workspace", mount_path="/workspace")],
            resources=client.V1ResourceRequirements(
                requests={
                    "cpu": settings.SIDECAR_CPU_REQUEST,
                    "memory": settings.SIDECAR_MEMORY_REQUEST,
                },
                limits={
                    "cpu": settings.SIDECAR_CPU_LIMIT,
                    "memory": settings.SIDECAR_MEMORY_LIMIT,
                },
            ),
        )
        
        template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(labels={"app": deployment_name}),
            spec=client.V1PodSpec(
                share_process_namespace=True, # Sidecar'Ä±n app'i kill edebilmesi iÃ§in
                containers=[container_app, container_sidecar],
                volumes=[client.V1Volume(name="workspace", empty_dir=client.V1EmptyDirVolumeSource())]
            )
        )
        
        deployment = client.V1Deployment(
            api_version="apps/v1",
            kind="Deployment",
            metadata=client.V1ObjectMeta(name=deployment_name),
            spec=client.V1DeploymentSpec(
                replicas=1,
                selector=client.V1LabelSelector(match_labels={"app": deployment_name}),
                template=template
            )
        )
        
        try:
            apps_v1.create_namespaced_deployment(namespace=namespace, body=deployment)
        except ApiException as e:
            if e.status != 409:
                raise

        # 3. Service oluÅŸtur
        service_name = f"project-{project_id}-svc"
        service = client.V1Service(
            api_version="v1",
            kind="Service",
            metadata=client.V1ObjectMeta(name=service_name),
            spec=client.V1ServiceSpec(
                selector={"app": deployment_name},
                ports=[client.V1ServicePort(port=80, target_port=8000)] # Gelen trafik sidecar'a
            )
        )
        try:
            core_v1.create_namespaced_service(namespace=namespace, body=service)
        except ApiException as e:
            if e.status != 409:
                raise

        # 4. Ingress oluÅŸtur
        ingress_name = f"project-{project_id}-ingress"
        preview_host = f"project-{project_id}.{settings.BASE_DOMAIN}"
        ingress = client.V1Ingress(
            api_version="networking.k8s.io/v1",
            kind="Ingress",
            metadata=client.V1ObjectMeta(
                name=ingress_name,
                annotations={
                    # Backward compatibility for controllers that still look at the annotation.
                    "kubernetes.io/ingress.class": settings.K8S_INGRESS_CLASS,
                },
            ),
            spec=client.V1IngressSpec(
                ingress_class_name=settings.K8S_INGRESS_CLASS,
                rules=[client.V1IngressRule(
                    host=preview_host,
                    http=client.V1HTTPIngressRuleValue(
                        paths=[client.V1HTTPIngressPath(
                            path="/",
                            path_type="Prefix",
                            backend=client.V1IngressBackend(
                                service=client.V1IngressServiceBackend(
                                    name=service_name,
                                    port=client.V1ServiceBackendPort(number=80)
                                )
                            )
                        )]
                    )
                )]
            )
        )
        try:
            networking_v1.create_namespaced_ingress(namespace=namespace, body=ingress)
        except ApiException as e:
            if e.status != 409:
                raise
                
        return preview_host, deployment_name, service_name, ingress_name

    try:
        result_tuple = await loop.run_in_executor(None, _create_k8s_objects)
    except Exception as e:
        msg = str(e).lower()
        if "connection refused" in msg or "max retries exceeded" in msg or "localhost" in msg:
            raise _k8s_not_ready_error() from e
        raise
    preview_host, deployment_name, service_name, ingress_name = result_tuple

    return {
        "namespace": namespace,
        "deployment_name": deployment_name,
        "service_name": service_name,
        "ingress_name": ingress_name,
        "preview_url": f"http://{preview_host}",
    }


async def delete_pod(
    project_id: str,
    namespace: str,
) -> bool:
    """Namespace'i silerek tÃ¼m pod objelerini (deployment, service vb.) k8s cluster'dan uÃ§urur."""
    logger.info("delete_pod_k8s", project_id=project_id, namespace=namespace)

    if not core_v1:
        logger.error("k8s_client_not_initialized")
        return False

    loop = asyncio.get_running_loop()

    def _delete_namespace():
        try:
            core_v1.delete_namespace(name=namespace)
        except ApiException as e:
            if e.status != 404: # Already deleted
                raise
                
    await loop.run_in_executor(None, _delete_namespace)
    return True


async def get_pod_status(
    project_id: str,
    namespace: str,
) -> str:
    """
    Pod'un gerÃ§ek k8s phase durumunu kontrol eder.
    """
    logger.debug("get_pod_status_k8s", project_id=project_id, namespace=namespace)

    if not core_v1:
        logger.warning("k8s_client_not_initialized_status_check")
        return "not_found"

    loop = asyncio.get_running_loop()

    def _status():
        try:
            pods = core_v1.list_namespaced_pod(
                namespace=namespace, 
                label_selector=f"app=project-{project_id}"
            )
            if not pods.items:
                return "not_found"
            
            # Replicas=1 olduÄŸundan ilk pod'u al
            pod = pods.items[0]
            return pod.status.phase.lower() # running, pending, failed vb.
        except ApiException:
            return "not_found"

    return await loop.run_in_executor(None, _status)


async def get_active_pod_count() -> int:
    """TÃ¼m isim alanlarÄ±ndaki running project-* pod'larÄ±nÄ± sayar."""
    # Şimdilik DB'den okunduğu için 0 dönmeye devam edebilir,
    # db'den kopup direkt k8s kullanılması isteniyorsa değiştirilebilir.
    return 0
