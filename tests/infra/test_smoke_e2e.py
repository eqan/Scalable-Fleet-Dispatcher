"""End-to-end smoke tests driven through the Ingress (never port-forward).

Each test exercises the real request path: Ingress -> Service -> API -> Redis/Mongo
(and the worker/stream pipeline), proving routing and integration are wired.
"""

import json
import time
import uuid
from typing import Optional

import requests

STATE_CHANGE_KINDS = {
    "order_created",
    "vehicle_created",
    "order_assigned",
    "route_optimized",
    "state_saved",
}


def _get(http: requests.Session, base_url: str, path: str) -> requests.Response:
    return http.get(f"{base_url}{path}", timeout=10)


def _state(http: requests.Session, base_url: str) -> dict:
    response = _get(http, base_url, "/api/state")
    response.raise_for_status()
    return response.json()


def _post(http: requests.Session, base_url: str, path: str, payload: dict) -> requests.Response:
    return http.post(f"{base_url}{path}", json=payload, timeout=10)


def _delete_at_current_rev(http: requests.Session, base_url: str, path: str) -> None:
    rev = _state(http, base_url)["rev"]
    http.delete(f"{base_url}{path}?baseRev={rev}", timeout=10)


def _route_for_vehicle(state: dict, vehicle_id: str) -> list[str]:
    for assignment in state.get("solution", {}).get("assignments", []):
        if assignment.get("vehicle_id") == vehicle_id:
            return assignment.get("route", [])
    return []


def test_https_root_is_served(http: requests.Session, base_url: str) -> None:
    response = _get(http, base_url, "/")
    assert response.status_code == 200
    assert "<!doctype html>" in response.text.lower()


def test_health_reports_connected_dependencies(http: requests.Session, base_url: str) -> None:
    body = _get(http, base_url, "/api/health").json()
    assert body["status"] == "healthy"
    assert body["services"]["redis"]["status"] == "connected"
    assert body["services"]["mongo"]["status"] == "connected"


def test_state_is_hydrated_via_ingress(http: requests.Session, base_url: str) -> None:
    body = _state(http, base_url)
    assert body["vehicles"], "expected seeded vehicles"
    assert body["orders"], "expected seeded orders"
    assert isinstance(body["solution"]["assignments"], list)
    assert isinstance(body["unassignedOrderIds"], list)
    assert isinstance(body["rev"], int)


def test_assignment_round_trip_is_visible_through_ingress(
    http: requests.Session,
    base_url: str,
) -> None:
    vehicle_id = f"infra-v-{uuid.uuid4().hex[:8]}"
    order_id = f"infra-o-{uuid.uuid4().hex[:8]}"

    try:
        assert _post(http, base_url, "/api/vehicles", {
            "id": vehicle_id,
            "name": "Infra Test Vehicle",
            "capacity_kg": 800,
            "start_location": {"lat": 40.7128, "lng": -74.0060},
        }).status_code == 201

        assert _post(http, base_url, "/api/orders", {
            "id": order_id,
            "weight_kg": 25,
            "location": {"lat": 40.7306, "lng": -73.9352},
            "service_time_min": 15,
        }).status_code == 201

        assign = _post(http, base_url, "/api/assign", {
            "orderId": order_id,
            "vehicleId": vehicle_id,
            "baseRev": _state(http, base_url)["rev"],
        })
        assert assign.status_code == 200

        state_after = _state(http, base_url)
        assert order_id in _route_for_vehicle(state_after, vehicle_id)
        assert order_id not in state_after["unassignedOrderIds"]
    finally:
        _delete_at_current_rev(http, base_url, f"/api/orders/{order_id}")
        _delete_at_current_rev(http, base_url, f"/api/vehicles/{vehicle_id}")


def test_optimize_pipeline_updates_state_revision(
    http: requests.Session,
    base_url: str,
) -> None:
    before_rev = _state(http, base_url)["rev"]

    response = _post(http, base_url, "/api/optimize", {"vehicleId": "v_001"})
    assert response.status_code == 202
    assert response.json()["requestId"]

    deadline = time.time() + 20
    while time.time() < deadline:
        if _state(http, base_url)["rev"] > before_rev:
            return
        time.sleep(1)

    raise AssertionError("optimization result did not update state in time")


def _next_state_change(response: requests.Response, deadline: float) -> Optional[dict]:
    """Parse the SSE byte stream and return the first `state_changed` payload."""
    event_name: Optional[str] = None
    data: list[str] = []

    for raw in response.iter_lines(decode_unicode=True):
        if time.time() > deadline:
            return None
        line = (raw or "").rstrip("\r")
        if line == "":  # blank line terminates one event
            if event_name == "state_changed" and data:
                return json.loads("\n".join(data))
            event_name, data = None, []
        elif line.startswith("event:"):
            event_name = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data.append(line[len("data:"):].strip())
    return None


def test_sse_stream_emits_state_change_events(
    http: requests.Session,
    base_url: str,
) -> None:
    order_id = f"infra-sse-{uuid.uuid4().hex[:8]}"

    with http.get(
        f"{base_url}/api/events",
        stream=True,
        timeout=(5, 25),
        headers={"Accept": "text/event-stream"},
    ) as response:
        assert response.status_code == 200

        # Trigger a mutation so the gateway broadcasts an event to our stream.
        assert _post(http, base_url, "/api/orders", {
            "id": order_id,
            "weight_kg": 15,
            "location": {"lat": 40.7410, "lng": -73.9897},
            "service_time_min": 10,
        }).status_code == 201

        try:
            payload = _next_state_change(response, deadline=time.time() + 20)
            assert payload is not None, "did not receive a state_changed SSE event"
            assert payload["kind"] in STATE_CHANGE_KINDS
        finally:
            _delete_at_current_rev(http, base_url, f"/api/orders/{order_id}")


def test_metrics_are_not_exposed_through_ingress(http: requests.Session, base_url: str) -> None:
    # Only /api is routed to the API; /metrics falls through to the web SPA and
    # must never return Prometheus exposition data through the public Ingress.
    body = _get(http, base_url, "/metrics").text
    assert "http_request_duration_ms" not in body
    assert not body.lstrip().startswith("# HELP")
