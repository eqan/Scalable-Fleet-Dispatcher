def resource_name(release_name: str, component: str) -> str:
    return f"{release_name}-{component}"


def policy_peers(policy, *, pods: bool = False) -> set[str]:
    """Allowed NetworkPolicy peers: pod app names (pods=True) or namespace names."""
    label = "app.kubernetes.io/name" if pods else "kubernetes.io/metadata.name"
    names: set[str] = set()
    for rule in policy.spec.ingress or []:
        for peer in rule.from_ or []:
            selector = peer.pod_selector if pods else peer.namespace_selector
            value = (getattr(selector, "match_labels", None) or {}).get(label)
            if value:
                names.add(value)
    return names
