import time

from kubernetes import client

from helpers import resource_name


def _get_container(pod_spec: client.V1PodSpec, name: str) -> client.V1Container:
    for container in pod_spec.containers:
        if container.name == name:
            return container
    raise AssertionError(f"Container {name!r} not found")


def _assert_resources(container: client.V1Container) -> None:
    resources = container.resources
    assert resources is not None, f"{container.name} is missing resources"
    assert resources.requests, f"{container.name} is missing resource requests"
    assert resources.limits, f"{container.name} is missing resource limits"
    for field in ("cpu", "memory"):
        assert field in resources.requests, f"{container.name} missing request {field}"
        assert field in resources.limits, f"{container.name} missing limit {field}"


def _assert_labels(
    metadata: client.V1ObjectMeta,
    component_name: str,
    component_kind: str,
    release_name: str,
) -> None:
    labels = metadata.labels or {}
    assert labels.get("app.kubernetes.io/name") == component_name
    assert labels.get("app.kubernetes.io/instance") == release_name
    assert labels.get("app.kubernetes.io/part-of") == "arqh-platform"
    assert labels.get("app.kubernetes.io/component") == component_kind
    assert labels.get("app.kubernetes.io/managed-by") == "Helm"


def test_deployments_ready(
    apps_api: client.AppsV1Api,
    namespace: str,
    release_name: str,
) -> None:
    for component in ("api", "worker", "web"):
        deployment = apps_api.read_namespaced_deployment(
            resource_name(release_name, component),
            namespace,
        )
        expected = deployment.spec.replicas
        assert deployment.status.ready_replicas == expected
        assert deployment.status.available_replicas == expected


def test_statefulsets_ready(
    apps_api: client.AppsV1Api,
    namespace: str,
    release_name: str,
) -> None:
    for component in ("redis", "mongo"):
        statefulset = apps_api.read_namespaced_stateful_set(
            resource_name(release_name, component),
            namespace,
        )
        assert statefulset.status.ready_replicas == 1


def test_standard_labels_present(
    apps_api: client.AppsV1Api,
    core_api: client.CoreV1Api,
    networking_api: client.NetworkingV1Api,
    namespace: str,
    release_name: str,
) -> None:
    _assert_labels(
        apps_api.read_namespaced_deployment(resource_name(release_name, "api"), namespace).metadata,
        "api",
        "backend",
        release_name,
    )
    _assert_labels(
        apps_api.read_namespaced_deployment(resource_name(release_name, "worker"), namespace).metadata,
        "worker",
        "worker",
        release_name,
    )
    _assert_labels(
        apps_api.read_namespaced_deployment(resource_name(release_name, "web"), namespace).metadata,
        "web",
        "proxy",
        release_name,
    )
    _assert_labels(
        apps_api.read_namespaced_stateful_set(resource_name(release_name, "redis"), namespace).metadata,
        "redis",
        "datastore",
        release_name,
    )
    _assert_labels(
        apps_api.read_namespaced_stateful_set(resource_name(release_name, "mongo"), namespace).metadata,
        "mongo",
        "datastore",
        release_name,
    )
    _assert_labels(
        core_api.read_namespaced_service(resource_name(release_name, "api"), namespace).metadata,
        "api",
        "backend",
        release_name,
    )
    _assert_labels(
        networking_api.read_namespaced_ingress(resource_name(release_name, "ingress"), namespace).metadata,
        "ingress",
        "proxy",
        release_name,
    )


def test_api_probes_are_split(
    apps_api: client.AppsV1Api,
    namespace: str,
    release_name: str,
) -> None:
    deployment = apps_api.read_namespaced_deployment(
        resource_name(release_name, "api"),
        namespace,
    )
    container = _get_container(deployment.spec.template.spec, "api")

    assert container.readiness_probe is not None
    assert container.liveness_probe is not None
    assert container.startup_probe is not None

    assert container.readiness_probe.http_get.path == "/api/health"
    assert container.liveness_probe.http_get.path == "/api/live"
    assert container.startup_probe.http_get.path == "/api/live"
    assert container.readiness_probe.http_get.path != container.liveness_probe.http_get.path


def test_all_containers_have_requests_and_limits(
    apps_api: client.AppsV1Api,
    namespace: str,
    release_name: str,
) -> None:
    for component in ("api", "worker", "web"):
        deployment = apps_api.read_namespaced_deployment(
            resource_name(release_name, component),
            namespace,
        )
        for container in deployment.spec.template.spec.containers:
            _assert_resources(container)

    for component in ("redis", "mongo"):
        statefulset = apps_api.read_namespaced_stateful_set(
            resource_name(release_name, component),
            namespace,
        )
        for container in statefulset.spec.template.spec.containers:
            _assert_resources(container)


def test_config_and_secret_mapping(
    apps_api: client.AppsV1Api,
    core_api: client.CoreV1Api,
    namespace: str,
    release_name: str,
) -> None:
    config_name = resource_name(release_name, "config")
    secret_name = resource_name(release_name, "secrets")

    config_map = core_api.read_namespaced_config_map(config_name, namespace)
    secret = core_api.read_namespaced_secret(secret_name, namespace)

    expected_config_keys = {
        "PORT",
        "ENV",
        "REDIS_HOST",
        "REDIS_PORT",
        "REDIS_DB",
        "MONGO_URI",
        "MONGO_DATABASE",
        "CORS_ORIGIN",
        "RATE_LIMIT_WINDOW_MS",
        "RATE_LIMIT_GENERAL_MAX",
        "RATE_LIMIT_MUTATION_MAX",
        "REHYDRATION_GUARD_CHECK_MS",
        "SSE_REPLAY_BUFFER_SIZE",
        "STATE_READ_VALIDATE",
    }
    assert expected_config_keys.issubset(set(config_map.data))

    for secret_key in ("REDIS_PASSWORD", "REDIS_USERNAME"):
        assert secret_key in secret.data
        assert secret_key not in config_map.data

    api_container = _get_container(
        apps_api.read_namespaced_deployment(resource_name(release_name, "api"), namespace).spec.template.spec,
        "api",
    )
    worker_container = _get_container(
        apps_api.read_namespaced_deployment(resource_name(release_name, "worker"), namespace).spec.template.spec,
        "worker",
    )

    for container in (api_container, worker_container):
        env_from = container.env_from or []
        config_refs = [ref.config_map_ref.name for ref in env_from if ref.config_map_ref]
        secret_refs = [ref.secret_ref.name for ref in env_from if ref.secret_ref]
        assert config_name in config_refs
        assert secret_name in secret_refs


def test_api_hpa_has_live_metrics(
    autoscaling_api: client.AutoscalingV2Api,
    namespace: str,
    release_name: str,
) -> None:
    deadline = time.time() + 60
    while time.time() < deadline:
        hpa = autoscaling_api.read_namespaced_horizontal_pod_autoscaler(
            resource_name(release_name, "api"),
            namespace,
        )
        if hpa.status.current_metrics:
            assert hpa.spec.min_replicas == 2
            return
        time.sleep(2)

    raise AssertionError("api HPA never reported current metrics")


def test_ingress_is_configured_for_tls_and_split_routing(
    networking_api: client.NetworkingV1Api,
    core_api: client.CoreV1Api,
    namespace: str,
    release_name: str,
    ingress_host: str,
) -> None:
    ingress = networking_api.read_namespaced_ingress(
        resource_name(release_name, "ingress"),
        namespace,
    )
    assert ingress.spec.ingress_class_name == "nginx"
    assert ingress.spec.tls is not None
    assert ingress.spec.tls[0].secret_name
    assert ingress.spec.tls[0].hosts == [ingress_host]

    rules = ingress.spec.rules or []
    assert len(rules) == 1
    assert rules[0].host == ingress_host

    paths = {
        path.path: path.backend.service.name
        for path in (rules[0].http.paths or [])
    }
    assert paths["/api"] == resource_name(release_name, "api")
    assert paths["/"] == resource_name(release_name, "web")

    annotations = ingress.metadata.annotations or {}
    assert annotations["nginx.ingress.kubernetes.io/proxy-buffering"] == "off"

    headers_name = resource_name(release_name, "ingress-headers")
    assert annotations["nginx.ingress.kubernetes.io/proxy-set-headers"] == (
        f"{namespace}/{headers_name}"
    )
    headers = core_api.read_namespaced_config_map(headers_name, namespace).data or {}
    assert headers["X-Forwarded-Proto"] == "https"
    assert headers["X-Forwarded-Port"] == "443"
