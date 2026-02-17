# Kubilitics Helm Chart (R2.1, R2.2)

Deploys the Kubilitics backend into a Kubernetes cluster. Optionally, you can serve the frontend separately (e.g. static build behind ingress) or add it to this chart later (R2.2).

## Prerequisites

- Kubernetes 1.24+
- Helm 3+

## Install

```bash
# Add repo (if published)
# helm repo add kubilitics https://charts.kubilitics.io
# helm repo update

# Install with default values
helm install kubilitics ./deploy/helm/kubilitics

# Install with custom values
helm install kubilitics ./deploy/helm/kubilitics -f my-values.yaml
```

## Configuration

| Key | Description | Default |
|-----|-------------|---------|
| `replicaCount` | Number of backend replicas | 1 |
| `image.repository` | Backend image | ghcr.io/kubilitics/kubilitics-backend |
| `image.tag` | Image tag | 1.0.0 |
| `service.port` | Service port | 8080 |
| `persistence.enabled` | Use PVC for SQLite DB | true |
| `persistence.size` | PVC size | 1Gi |
| `config.port` | Backend listen port | 8080 |
| `config.databasePath` | SQLite path inside container | /data/kubilitics.db |
| `config.maxClusters` | Max registered clusters | 100 |
| `ingress.enabled` | Create Ingress | false |
| `frontend.enabled` | Deploy frontend (optional, R2.2) | false |

All backend options from `internal/config` can be set via env; the chart exposes the main ones. Use `KUBILITICS_*` env vars for the rest (add to deployment env if needed).

## In-cluster behavior

- The backend runs with the cluster's ServiceAccount and can list/read resources in the cluster (RBAC permitting).
- To manage multiple clusters, add them via the backend API (POST /api/v1/clusters) with kubeconfig or in-cluster config from other namespaces/clusters as needed.

## Optional frontend (R2.2)

Set `frontend.enabled: true` and add a second container or init container that serves the static frontend build (e.g. nginx serving `kubilitics-frontend/dist`), or use a separate Deployment/Ingress for the frontend. The backend API is then reached from the browser at the same origin (reverse proxy) or at a configured API URL.

## Build and push image

From repo root:

```bash
docker build -t ghcr.io/your-org/kubilitics-backend:1.0.0 -f kubilitics-backend/Dockerfile kubilitics-backend
docker push ghcr.io/your-org/kubilitics-backend:1.0.0
```

Use the same image name in `values.yaml` when installing. The backend Dockerfile is at `kubilitics-backend/Dockerfile`.
