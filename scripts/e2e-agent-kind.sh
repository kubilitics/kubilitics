#!/usr/bin/env bash
set -euo pipefail

CLUSTER=${CLUSTER:-kubilitics-e2e}
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)

echo "==> [1/6] Recreating kind cluster: $CLUSTER"
kind delete cluster --name "$CLUSTER" 2>/dev/null || true
kind create cluster --name "$CLUSTER"

echo "==> [2/6] Building images"
docker build -t kubilitics-hub:e2e   -f "$REPO_ROOT/kubilitics-backend/Dockerfile" "$REPO_ROOT"
docker build -t kubilitics-agent:e2e -f "$REPO_ROOT/kubilitics-agent/Dockerfile"   "$REPO_ROOT"

echo "==> [3/6] Loading images into kind"
kind load docker-image kubilitics-hub:e2e   --name "$CLUSTER"
kind load docker-image kubilitics-agent:e2e --name "$CLUSTER"

echo "==> [4/6] Installing hub"
kubectl create namespace kubilitics-system --dry-run=client -o yaml | kubectl apply -f -
helm dependency build "$REPO_ROOT/deploy/helm/kubilitics" || true
helm upgrade --install kubilitics "$REPO_ROOT/deploy/helm/kubilitics" \
  --namespace kubilitics-system \
  --set image.repository=kubilitics-hub \
  --set image.tag=e2e \
  --set image.pullPolicy=Never \
  --set database.type=sqlite \
  --set database.sqlite.path=/data/kubilitics.db \
  --set config.databasePath=/data/kubilitics.db \
  --set persistence.enabled=false \
  --wait --timeout 5m

echo "==> [5/6] Installing agent (same-cluster, no bootstrap token)"
# The hub Service name is the release name (kubilitics.fullname = release name when no
# nameOverride is set, per _helpers.tpl). With --install kubilitics the service is
# named "kubilitics" in namespace kubilitics-system, port 8190.
HUB_SVC="kubilitics"
helm upgrade --install kubilitics-agent "$REPO_ROOT/deploy/helm/kubilitics-agent" \
  --namespace kubilitics-system \
  --set image.repository=kubilitics-agent \
  --set image.tag=e2e \
  --set image.pullPolicy=Never \
  --set "hub.url=http://${HUB_SVC}.kubilitics-system.svc:8190" \
  --wait --timeout 2m

echo "==> [6/6] Waiting for heartbeat (60s)"
# The hub SQLite DB lives at /data/kubilitics.db inside the hub pod (Deployment name
# also equals the release name: "kubilitics").  We poll every 2s for up to 60s.
for i in {1..30}; do
  COUNT=$(kubectl -n kubilitics-system exec deploy/kubilitics -- \
    sqlite3 /data/kubilitics.db \
    "SELECT COUNT(*) FROM agent_clusters WHERE status='active';" 2>/dev/null || echo 0)
  if [[ "$COUNT" -ge 1 ]]; then
    echo "agent registered ($COUNT active cluster row)"
    kubectl -n kubilitics-system exec deploy/kubilitics -- \
      sqlite3 /data/kubilitics.db \
      "SELECT id,name,status,agent_version FROM agent_clusters;"
    exit 0
  fi
  echo "  attempt $i/30: COUNT=$COUNT — waiting..."
  sleep 2
done

echo "agent did not register within 60s"
echo "--- agent logs ---"
kubectl -n kubilitics-system logs deploy/kubilitics-agent --tail=50 || true
echo "--- hub logs ---"
kubectl -n kubilitics-system logs deploy/kubilitics --tail=80 || true
exit 1
