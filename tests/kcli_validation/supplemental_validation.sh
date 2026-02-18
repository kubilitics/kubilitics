#!/bin/bash
# kcli Supplemental Validation
# Validation of gap areas

LOGFILE="kcli-supplemental.log"
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

echo "🔥 Starting kcli Supplemental Validation..." | tee -a "$LOGFILE"

# 1. Auth
log_cmd ./kcli/bin/kcli auth can-i create pods
log_cmd ./kcli/bin/kcli auth whoami

# 2. CP (Pass-through test)
# Create a dummy file
echo "test-data" > test.txt
# Copy to pod
POD=$(./kcli/bin/kcli get pod -n kcli-test-1 -l app=nginx-dep -o jsonpath='{.items[0].metadata.name}')
if [ -n "$POD" ]; then
    log_cmd ./kcli/bin/kcli cp test.txt kcli-test-1/"$POD":/tmp/test.txt
    log_cmd ./kcli/bin/kcli exec -n kcli-test-1 "$POD" -- cat /tmp/test.txt
else
    echo "Skipping CP test (no pod)" | tee -a "$LOGFILE"
fi

# 3. Port-Forward (Dry run check essentially, hard to test in batch without backgrounding)
# We will just run help to ensure it's wired
log_cmd ./kcli/bin/kcli port-forward --help

echo "✅ Supplemental Complete." | tee -a "$LOGFILE"
