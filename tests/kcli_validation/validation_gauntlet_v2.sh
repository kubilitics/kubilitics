#!/bin/bash
# kcli Corrective Enforcement Validation Gauntlet V2
# STRICT EXECUTION - NO SUMMARIES - RAW OUTPUT CAPTURE

# Set CI/CD Mode to enforce non-interactive safety
export KCLI_CI=true

LOGFILE="kcli-evidence.log"
rm -f "$LOGFILE"

# Redirect stdout and stderr to logfile and console
exec > >(tee -a "$LOGFILE") 2>&1

echo "################################################################"
echo "# KCLI VALIDATION GAUNTLET V2"
echo "# DATE: $(date)"
echo "# ENV: KCLI_CI=$KCLI_CI"
echo "################################################################"
echo ""

run_test() {
    local DESC="$1"
    local CMD="$2"
    
    echo "----------------------------------------------------------------"
    echo "TEST: $DESC"
    echo "COMMAND: $CMD"
    echo "TIMESTAMP: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "OUTPUT >"
    eval "$CMD"
    local EXIT_CODE=$?
    echo "< OUTPUT"
    if [ $EXIT_CODE -eq 0 ]; then
        echo "STATUS: PASS"
    else
        echo "STATUS: FAIL (Exit Code: $EXIT_CODE)"
    fi
    echo "----------------------------------------------------------------"
    echo ""
    sleep 0.2 # Slight pause for log readability
}

# --- 1. CORE CRUD ---
run_test "Get Pods" "./kcli/bin/kcli get pods -n kcli-test-1"
run_test "Describe Pod" "./kcli/bin/kcli describe pod -n kcli-test-1 -l app=nginx-dep | head -n 20"
run_test "Create Resource (Dry Run)" "./kcli/bin/kcli create job hello-job --image=busybox --dry-run=client -o yaml"
# We use apply to actually create something for delete test
run_test "Apply Manifest" "printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: kcli-config-test\n  namespace: default\ndata:\n  key: value\n' | ./kcli/bin/kcli apply -f -"
run_test "Get ConfigMap" "./kcli/bin/kcli get cm kcli-config-test -n default -o yaml"
run_test "Edit (Simulated via patch)" "./kcli/bin/kcli patch cm kcli-config-test -n default --type=merge -p '{\"data\":{\"key\":\"updated\"}}'"
run_test "Delete Resource" "./kcli/bin/kcli delete cm kcli-config-test -n default"
# Missing: scale, rollout, annotate, label
run_test "Annotate" "./kcli/bin/kcli annotate pod -n kcli-test-1 -l app=nginx-dep test-annotation=true --overwrite"
run_test "Label" "./kcli/bin/kcli label pod -n kcli-test-1 -l app=nginx-dep test-label=true --overwrite"

# --- 2. INSPECTION ---
run_test "Logs (Tail)" "./kcli/bin/kcli logs -n kcli-test-1 -l app=nginx-dep --tail=2"
run_test "Events" "./kcli/bin/kcli events -n kcli-test-1"
# Top needs metrics server, might fail gracefully
run_test "Top Pods" "./kcli/bin/kcli top pods -n kcli-test-1"

# --- 3. DATA HANDLING ---
run_test "CP (Copy)" "./kcli/bin/kcli cp --help" # Just verify command exists/runs as pass-through
run_test "Diff" "./kcli/bin/kcli diff --help"
run_test "Port-Forward" "./kcli/bin/kcli port-forward --help"

# --- 4. CONFIG & AUTH ---
run_test "Version" "./kcli/bin/kcli version"
run_test "Cluster Info" "./kcli/bin/kcli cluster-info"
run_test "Auth Check" "./kcli/bin/kcli auth can-i create pods -n default"
run_test "Config View" "./kcli/bin/kcli config view"

# --- 5. NAMESPACE & CONTEXT ---
run_test "List Namespaces" "./kcli/bin/kcli ns list"
run_test "Switch Namespace" "./kcli/bin/kcli ns kcli-test-3"
run_test "Check Current Context" "./kcli/bin/kcli config current-context"

# --- 6. MULTI-RESOURCE ---
run_test "Get All Pods" "./kcli/bin/kcli get pods -A | head -n 10"
run_test "Get Deployments" "./kcli/bin/kcli get deploy -n kcli-test-1"

# --- 7. AI FEATURES ---
# These depend on provider configuration, which might be disabled. 
# We expect them to handle "disabled" state gracefully or execute if env is set.
run_test "AI Status" "./kcli/bin/kcli ai status"
run_test "AI Explain" "./kcli/bin/kcli explain pod"
run_test "Incident Mode" "./kcli/bin/kcli incident"

echo "################################################################"
echo "# GAUNTLET COMPLETE"
echo "################################################################"
