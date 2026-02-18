#!/bin/bash
# kcli Deep Dive Validation Gauntlet
# Captures output for every command to kcli-validation.log

LOGFILE="kcli-validation.log"
rm -f "$LOGFILE"

log_cmd() {
    echo "----------------------------------------------------------------" | tee -a "$LOGFILE"
    echo "COMMAND: $@" | tee -a "$LOGFILE"
    echo "TIMESTAMP: $(date -uIs)" | tee -a "$LOGFILE"
    echo "OUTPUT:" | tee -a "$LOGFILE"
    "$@" >> "$LOGFILE" 2>&1
    local status=$?
    echo "" | tee -a "$LOGFILE"
    if [ $status -eq 0 ]; then
        echo "STATUS: PASS" | tee -a "$LOGFILE"
    else
        echo "STATUS: FAIL (Exit Code: $status)" | tee -a "$LOGFILE"
    fi
    echo "----------------------------------------------------------------" | tee -a "$LOGFILE"
    echo "" | tee -a "$LOGFILE"
}

echo "🔥 Starting kcli Deep Dive Validation..." | tee -a "$LOGFILE"

# 1. Version & Config
log_cmd ./kcli/bin/kcli version
log_cmd ./kcli/bin/kcli config view --minify

# 2. Core Read Commands
log_cmd ./kcli/bin/kcli get pods -A
log_cmd ./kcli/bin/kcli get pods -n kcli-test-1 -o wide
log_cmd ./kcli/bin/kcli get deploy -n kcli-test-1 -o yaml
log_cmd ./kcli/bin/kcli describe pod -n kcli-test-1 -l app=nginx-dep
log_cmd ./kcli/bin/kcli get nodes
log_cmd ./kcli/bin/kcli get services -A

# 3. Logs (Multi-Pod & Single)
# We need a running pod. Let's pick one from kcli-test-1
POD=$(./kcli/bin/kcli get pod -n kcli-test-1 -l app=nginx-dep -o jsonpath='{.items[0].metadata.name}')
if [ -n "$POD" ]; then
    log_cmd ./kcli/bin/kcli logs "$POD" -n kcli-test-1 --tail=5
    log_cmd ./kcli/bin/kcli logs -n kcli-test-1 -l app=nginx-dep --tail=2 --prefix=true
else
    echo "Skipping logs test (no pod found)" | tee -a "$LOGFILE"
fi

# 4. Context & Namespace
log_cmd ./kcli/bin/kcli ns
log_cmd ./kcli/bin/kcli ctx
log_cmd ./kcli/bin/kcli ns kcli-test-2
log_cmd ./kcli/bin/kcli ns default # switch back

# 5. Lifecycle (Create/Apply/Delete) - using --force for automation
cat <<EOF > test-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: gauntlet-pod
  namespace: kcli-test-3
spec:
  containers:
  - name: nginx
    image: nginx:alpine
EOF

log_cmd ./kcli/bin/kcli apply -f test-pod.yaml --force
log_cmd ./kcli/bin/kcli get pod gauntlet-pod -n kcli-test-3
log_cmd ./kcli/bin/kcli delete pod gauntlet-pod -n kcli-test-3 --force

# 6. Advanced
# Top (might fail if metrics server not installed, but we test execution)
log_cmd ./kcli/bin/kcli top nodes
log_cmd ./kcli/bin/kcli top pods -A

# 7. AI & Incident (Mocked or Real if configured)
# We expect these might fail or show "AI disabled" but that IS a result.
log_cmd ./kcli/bin/kcli ai status
log_cmd ./kcli/bin/kcli incident    

# 8. Help & Explain
log_cmd ./kcli/bin/kcli explain pod

echo "✅ Validation Complete. Check $LOGFILE" | tee -a "$LOGFILE"
