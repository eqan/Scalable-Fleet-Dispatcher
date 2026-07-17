import contextlib
import json
import socket
import subprocess
import time

import requests
from kubernetes import client


def _get_free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@contextlib.contextmanager
def _port_forward(namespace: str, service: str, remote_port: int):
    """Prometheus stays ClusterIP-only; port-forward is the deliberate internal probe."""
    local_port = _get_free_port()
    process = subprocess.Popen(
        [
            "kubectl",
            "-n",
            namespace,
            "port-forward",
            f"svc/{service}",
            f"{local_port}:{remote_port}",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.time() + 30
        while time.time() < deadline:
            if process.poll() is not None:
                raise AssertionError(f"port-forward for {service!r} exited unexpectedly")
            try:
                response = requests.get(f"http://127.0.0.1:{local_port}/-/ready", timeout=1)
                if response.ok:
                    break
            except requests.RequestException:
                time.sleep(1)
        else:
            raise AssertionError(f"port-forward for {service!r} never became ready")

        yield local_port
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def _assert_ready(replicas_ready, replicas_desired, name: str) -> None:
    assert replicas_desired is not None and replicas_desired > 0, f"{name} has no desired replicas"
    assert (replicas_ready or 0) == replicas_desired, (
        f"{name} not ready: ready={replicas_ready} desired={replicas_desired}"
    )


def test_monitoring_workloads_ready(
    apps_api: client.AppsV1Api,
    monitoring_namespace: str,
) -> None:
    grafana = apps_api.read_namespaced_deployment("monitoring-grafana", monitoring_namespace)
    _assert_ready(grafana.status.ready_replicas, grafana.spec.replicas, "grafana")

    operator = apps_api.read_namespaced_deployment(
        "monitoring-kube-prometheus-operator",
        monitoring_namespace,
    )
    _assert_ready(operator.status.ready_replicas, operator.spec.replicas, "prometheus-operator")

    kube_state_metrics = apps_api.read_namespaced_deployment(
        "monitoring-kube-state-metrics",
        monitoring_namespace,
    )
    _assert_ready(
        kube_state_metrics.status.ready_replicas,
        kube_state_metrics.spec.replicas,
        "kube-state-metrics",
    )

    loki = apps_api.read_namespaced_stateful_set("monitoring-loki", monitoring_namespace)
    _assert_ready(loki.status.ready_replicas, loki.spec.replicas, "loki")

    promtail = apps_api.read_namespaced_daemon_set("monitoring-promtail", monitoring_namespace)
    desired = promtail.status.desired_number_scheduled
    assert desired is not None and desired > 0
    assert promtail.status.number_ready == desired


def test_api_service_monitor_exists(
    custom_objects_api: client.CustomObjectsApi,
    monitoring_namespace: str,
    release_name: str,
) -> None:
    service_monitor = custom_objects_api.get_namespaced_custom_object(
        group="monitoring.coreos.com",
        version="v1",
        namespace=monitoring_namespace,
        plural="servicemonitors",
        name="arqh-api",
    )
    endpoint = service_monitor["spec"]["endpoints"][0]
    assert endpoint["path"] == "/metrics"
    assert service_monitor["spec"]["selector"]["matchLabels"]["app.kubernetes.io/name"] == "api"
    assert (
        service_monitor["spec"]["selector"]["matchLabels"]["app.kubernetes.io/instance"]
        == release_name
    )


def test_grafana_ingress_serves_login_page(http: requests.Session, grafana_host: str) -> None:
    response = http.get(f"https://{grafana_host}/login", timeout=10)
    assert response.status_code == 200
    assert "grafana" in response.text.lower()


def test_prometheus_scrapes_arqh_api(monitoring_namespace: str) -> None:
    # Allow one scrape interval after the API Service appears.
    with _port_forward(monitoring_namespace, "monitoring-kube-prometheus-prometheus", 9090) as port:
        deadline = time.time() + 90
        last_payload = None
        while time.time() < deadline:
            response = requests.get(
                f"http://127.0.0.1:{port}/api/v1/query",
                params={"query": 'up{job="arqh-api"}'},
                timeout=10,
            )
            response.raise_for_status()
            last_payload = response.json()
            assert last_payload["status"] == "success"
            results = last_payload["data"]["result"]
            values = [float(item["value"][1]) for item in results]
            if results and any(value == 1.0 for value in values):
                return
            time.sleep(2)

        raise AssertionError(
            f"expected Prometheus arqh-api scrape target UP within 90s; last={last_payload}"
        )


def test_grafana_provisioning_configmaps_exist(
    core_api: client.CoreV1Api,
    monitoring_namespace: str,
) -> None:
    datasources = core_api.read_namespaced_config_map(
        "monitoring-grafana-datasources",
        monitoring_namespace,
    )
    assert "datasources.yaml" in (datasources.data or {})

    dashboard = core_api.read_namespaced_config_map(
        "monitoring-grafana-dashboard-platform-observability",
        monitoring_namespace,
    )
    assert "platform-observability.json" in (dashboard.data or {})
    json.loads(dashboard.data["platform-observability.json"])
