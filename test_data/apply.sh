#!/usr/bin/env bash
# Apply demo resources for Kubilitics (Workloads + Networking).
# Idempotent: skips a category if current count >= MIN_COUNT. Requires kubectl.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NAMESPACE="${NAMESPACE:-kubilitics-demo}"
MIN_COUNT="${MIN_COUNT:-3}"

count_in_ns() {
  kubectl get "$1" -n "$NAMESPACE" --no-headers 2>/dev/null | wc -l | tr -d ' '
}

count_cluster_scoped() {
  kubectl get "$1" --no-headers -A 2>/dev/null | wc -l | tr -d ' '
}

apply_if_below() {
  local kind=$1
  local file=$2
  local count_fn=${3:-count_in_ns}
  local current
  current=$("$count_fn" "$kind")
  if [ "$current" -lt "$MIN_COUNT" ]; then
    echo "Applying $file ($kind count $current < $MIN_COUNT)"
    kubectl apply -f "$file"
  else
    echo "Skipping $file ($kind count $current >= $MIN_COUNT)"
  fi
}

echo "Namespace: $NAMESPACE, min count: $MIN_COUNT"
echo "Creating namespace if needed..."
kubectl apply -f namespace.yaml

echo "Workloads..."
apply_if_below deployments workloads/deployments.yaml
apply_if_below statefulsets workloads/statefulsets.yaml
apply_if_below daemonsets workloads/daemonsets.yaml
apply_if_below jobs workloads/jobs.yaml
apply_if_below cronjobs workloads/cronjobs.yaml

echo "Networking..."
apply_if_below services networking/services.yaml
apply_if_below ingressclasses networking/ingressclasses.yaml count_cluster_scoped
apply_if_below ingresses networking/ingresses.yaml
apply_if_below networkpolicies networking/networkpolicies.yaml

echo "Done."
