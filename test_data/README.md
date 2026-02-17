# Kubilitics Demo Data (test_data)

Demo YAMLs and apply scripts for **Workloads** and **Networking** resources so Kubilitics list/detail views show real data (e.g. for investor demos). Aligns with [kubilitics-resource-design-document.md](../project-docs/kubilitics-resource-design-document.md) sections 2.x (Workloads) and 3.x (Networking).

## Prerequisites

- `kubectl` in PATH
- Cluster access (e.g. `kubectl cluster-info`)

## Resource counts (target)

| Category   | Resource        | Approx. count | Notes                          |
|-----------|-----------------|---------------|--------------------------------|
| Workloads | Deployments     | 5             |                                |
| Workloads | StatefulSets    | 3             | Includes headless Services     |
| Workloads | DaemonSets      | 2             |                                |
| Workloads | Jobs            | 5             |                                |
| Workloads | CronJobs        | 5             |                                |
| Networking| IngressClasses  | 5             | Cluster-scoped                 |
| Networking| Services        | 7             |                                |
| Networking| Ingresses       | 5             |                                |
| Networking| NetworkPolicies | 7             |                                |

**Endpoints** and **Endpoint Slices** are created automatically by the control plane when Services exist; no separate YAMLs.

## How to run

From the **repository root** or from **test_data/**:

**Shell:**

```bash
# From repo root
./test_data/apply.sh

# Or from test_data
cd test_data && ./apply.sh
```

**Python 3:**

```bash
python3 test_data/apply.py
# Options: --namespace kubilitics-demo, --min-count 3, --dry-run
```

## Behavior

- **Idempotent**: Safe to run multiple times. Uses `kubectl apply -f` with fixed resource names.
- **Skip when enough**: For each resource type, if the current count (in namespace `kubilitics-demo`, or cluster-wide for IngressClass) is already **>= 3** (or `MIN_COUNT`), that category is skipped.
- **Order**: Namespace → Workloads (Deployments, StatefulSets, DaemonSets, Jobs, CronJobs) → Services → IngressClasses → Ingresses → NetworkPolicies.

## Environment / options

| Env (shell) / Option (Python) | Default            | Description        |
|-------------------------------|--------------------|--------------------|
| `NAMESPACE` / `--namespace`   | `kubilitics-demo`  | Target namespace   |
| `MIN_COUNT` / `--min-count`  | `3`                | Skip if count ≥ this |
| — / `--dry-run`               | —                  | Print only (Python) |

## Layout

```
test_data/
  README.md
  namespace.yaml
  apply.sh
  apply.py
  workloads/
    deployments.yaml
    statefulsets.yaml
    daemonsets.yaml
    jobs.yaml
    cronjobs.yaml
  networking/
    ingressclasses.yaml
    services.yaml
    ingresses.yaml
    networkpolicies.yaml
```
