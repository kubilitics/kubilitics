#!/bin/bash
set -e

# Ensure kcli is built
echo "🔨 Building kcli..."
make kcli > /dev/null

KCLI="./kcli/bin/kcli --force"

echo "🎯 Phase 2: Real Cluster Test Preparation"

# 1. Namespaces
echo "📦 [1/8] Creating Namespaces..."
for ns in kcli-test-1 kcli-test-2 kcli-test-3; do
    $KCLI create namespace $ns --dry-run=client -o yaml | $KCLI apply -f -
    echo "   ✅ Namespace $ns created"
done

# 2. Deployments
echo "🚀 [2/8] Creating Deployments..."
$KCLI create deployment nginx-dep --image=nginx:alpine -n kcli-test-1 --replicas=3 --dry-run=client -o yaml | $KCLI apply -f -
$KCLI create deployment redis-dep --image=redis:alpine -n kcli-test-2 --replicas=1 --dry-run=client -o yaml | $KCLI apply -f -
echo "   ✅ Deployments created"

# 3. Services
echo "🌐 [3/8] Creating Services..."
$KCLI expose deployment nginx-dep --port=80 --target-port=80 --type=ClusterIP --name=nginx-svc -n kcli-test-1 --dry-run=client -o yaml | $KCLI apply -f -
echo "   ✅ Services created"

# 4. ConfigMaps & Secrets
echo "📝 [4/8] Creating ConfigMaps & Secrets..."
$KCLI create configmap app-config --from-literal=key1=value1 --from-literal=key2=value2 -n kcli-test-1 --dry-run=client -o yaml | $KCLI apply -f -
$KCLI create secret generic app-secret --from-literal=password=secret123 -n kcli-test-1 --dry-run=client -o yaml | $KCLI apply -f -
echo "   ✅ ConfigMaps & Secrets created"

# 5. StatefulSet (using a simple manifest)
echo "💾 [5/8] Creating StatefulSet..."
cat <<EOF | $KCLI apply -n kcli-test-1 -f -
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:alpine
EOF
echo "   ✅ StatefulSet created"

# 6. DaemonSet
echo "👻 [6/8] Creating DaemonSet..."
cat <<EOF | $KCLI apply -n kcli-test-3 -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd-elasticsearch
spec:
  selector:
    matchLabels:
      name: fluentd-elasticsearch
  template:
    metadata:
      labels:
        name: fluentd-elasticsearch
    spec:
      tolerations:
      - key: node-role.kubernetes.io/master
        effect: NoSchedule
      containers:
      - name: fluentd-elasticsearch
        image: quay.io/fluentd_elasticsearch/fluentd:v2.5.2
EOF
echo "   ✅ DaemonSet created"

# 7. Jobs & CronJobs
echo "⏰ [7/8] Creating Jobs & CronJobs..."
$KCLI delete job hello-job -n kcli-test-2 --ignore-not-found
$KCLI delete cronjob hello-cron -n kcli-test-2 --ignore-not-found

cat <<EOF | $KCLI apply -n kcli-test-2 -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: hello-job
spec:
  template:
    spec:
      containers:
      - name: hello-job
        image: busybox
        command: ["echo", "Hello World"]
      restartPolicy: Never
EOF

cat <<EOF | $KCLI apply -n kcli-test-2 -f -
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello-cron
spec:
  schedule: "*/1 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: hello-cron
            image: busybox
            command: ["echo", "Hello kcli"]
          restartPolicy: OnFailure
EOF
echo "   ✅ Jobs & CronJobs created"

# 8. RBAC
echo "🔒 [8/8] Creating RBAC Roles..."
$KCLI create role pod-reader --verb=get --verb=list --verb=watch --resource=pods -n kcli-test-1 --dry-run=client -o yaml | $KCLI apply -f -
$KCLI create rolebinding read-pods --role=pod-reader --serviceaccount=kcli-test-1:default -n kcli-test-1 --dry-run=client -o yaml | $KCLI apply -f -
echo "   ✅ RBAC resources created"

echo "🎉 Phase 2 Complete: Cluster populated with test resources."
