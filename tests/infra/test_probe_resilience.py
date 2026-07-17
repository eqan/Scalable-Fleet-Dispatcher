import time

import requests
from kubernetes import client

from helpers import resource_name


def _api_restart_total(core_api: client.CoreV1Api, namespace: str, release_name: str) -> int:
    pods = core_api.list_namespaced_pod(
        namespace,
        label_selector=f"app.kubernetes.io/instance={release_name},app.kubernetes.io/name=api",
    ).items
    total = 0
    for pod in pods:
        for status in pod.status.container_statuses or []:
            total += status.restart_count
    return total


def _api_endpoints_available(core_api: client.CoreV1Api, namespace: str, release_name: str) -> bool:
    endpoints = core_api.read_namespaced_endpoints(resource_name(release_name, "api"), namespace)
    for subset in endpoints.subsets or []:
        if subset.addresses:
            return True
    return False


def test_redis_failure_flips_readiness_without_restarting_api(
    core_api: client.CoreV1Api,
    apps_api: client.AppsV1Api,
    http: requests.Session,
    namespace: str,
    release_name: str,
    base_url: str,
) -> None:
    redis_selector = f"app.kubernetes.io/instance={release_name},app.kubernetes.io/name=redis"
    redis_pod = core_api.list_namespaced_pod(namespace, label_selector=redis_selector).items[0]
    restart_total_before = _api_restart_total(core_api, namespace, release_name)

    core_api.delete_namespaced_pod(redis_pod.metadata.name, namespace, grace_period_seconds=0)

    degraded = False
    deadline = time.time() + 90
    while time.time() < deadline:
        try:
            response = http.get(f"{base_url}/api/health", timeout=10)
            unhealthy = response.status_code != 200
        except requests.RequestException:
            unhealthy = True

        if unhealthy or not _api_endpoints_available(core_api, namespace, release_name):
            degraded = True
            break
        time.sleep(2)

    assert degraded, "readiness never degraded after deleting the redis pod"

    recovery_deadline = time.time() + 180
    while time.time() < recovery_deadline:
        statefulset = apps_api.read_namespaced_stateful_set(resource_name(release_name, "redis"), namespace)
        if statefulset.status.ready_replicas == 1:
            response = http.get(f"{base_url}/api/health", timeout=10)
            if response.status_code == 200:
                break
        time.sleep(3)
    else:
        raise AssertionError("redis did not recover and restore API health in time")

    restart_total_after = _api_restart_total(core_api, namespace, release_name)
    assert restart_total_after == restart_total_before
