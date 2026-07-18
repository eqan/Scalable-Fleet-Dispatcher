import os

import pytest
import requests
import urllib3
from kubernetes import client, config


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def _load_kube_config() -> None:
    kubeconfig = os.getenv("KUBECONFIG")
    if kubeconfig:
        config.load_kube_config(config_file=kubeconfig)
    else:
        config.load_kube_config()


@pytest.fixture(scope="session", autouse=True)
def kube_config() -> None:
    _load_kube_config()


@pytest.fixture(scope="session")
def namespace() -> str:
    return os.getenv("K8S_NAMESPACE", "arqh")


@pytest.fixture(scope="session")
def release_name() -> str:
    return os.getenv("RELEASE_NAME", "arqh")


@pytest.fixture(scope="session")
def ingress_host() -> str:
    return os.getenv("INGRESS_HOST", "arqh.localtest.me")


@pytest.fixture(scope="session")
def monitoring_namespace() -> str:
    return os.getenv("MONITORING_NAMESPACE", "monitoring")


@pytest.fixture(scope="session")
def grafana_host() -> str:
    return os.getenv("GRAFANA_HOST", "grafana.arqh.localtest.me")


@pytest.fixture(scope="session")
def base_url(ingress_host: str) -> str:
    return f"https://{ingress_host}"


@pytest.fixture(scope="session")
def core_api() -> client.CoreV1Api:
    return client.CoreV1Api()


@pytest.fixture(scope="session")
def apps_api() -> client.AppsV1Api:
    return client.AppsV1Api()


@pytest.fixture(scope="session")
def autoscaling_api() -> client.AutoscalingV2Api:
    return client.AutoscalingV2Api()


@pytest.fixture(scope="session")
def networking_api() -> client.NetworkingV1Api:
    return client.NetworkingV1Api()


@pytest.fixture(scope="session")
def policy_api() -> client.PolicyV1Api:
    return client.PolicyV1Api()


@pytest.fixture(scope="session")
def custom_objects_api() -> client.CustomObjectsApi:
    return client.CustomObjectsApi()


@pytest.fixture(scope="session")
def http() -> requests.Session:
    session = requests.Session()
    session.verify = False
    session.headers.update({"Accept": "application/json"})
    yield session
    session.close()
