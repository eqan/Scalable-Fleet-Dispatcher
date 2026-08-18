# Infra Tests

These tests verify the Kubernetes integration for Pillar A and Pillar C:

- `test_cluster_state.py` checks Deployments, StatefulSets, labels, probes, resources, secrets, ConfigMaps, HPA metrics, and Ingress wiring.
- `test_smoke_e2e.py` drives traffic through the Ingress over HTTPS and validates health, hydration, mutations, optimize flow, SSE, and `/metrics` non-exposure.
- `test_zz_probe_resilience.py` deletes a Redis pod and verifies API readiness degrades and recovers without restarting the API pods (runs last so recovery cannot flake later smoke tests).

## Run

```bash
python3 -m pip install -r tests/infra/requirements.txt
INGRESS_HOST=dispatch.localtest.me KUBECONFIG=~/.kube/config pytest tests/infra -v
```

Optional overrides:

- `K8S_NAMESPACE` defaults to `dispatch`
- `RELEASE_NAME` defaults to `dispatch`
