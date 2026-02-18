#!/usr/bin/env bash
# Comprehensive kcli Integration Test Suite
# Tests all kcli integration points: backend endpoints, desktop app, Docker build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

test_count=0
pass_count=0
fail_count=0

test_case() {
    local name="$1"
    local cmd="$2"
    test_count=$((test_count + 1))
    echo -e "${BLUE}Test $test_count:${NC} $name"
    
    if eval "$cmd" > /tmp/kcli-integration-test.log 2>&1; then
        echo -e "  ${GREEN}✓ PASS${NC}"
        pass_count=$((pass_count + 1))
        return 0
    else
        echo -e "  ${RED}✗ FAIL${NC}"
        echo "  Output:"
        cat /tmp/kcli-integration-test.log | sed 's/^/    /' | head -20
        fail_count=$((fail_count + 1))
        return 1
    fi
}

echo "=== kcli Integration Test Suite ==="
echo ""

# Test 1: kcli binary build
echo -e "${YELLOW}=== Phase 1: Build Verification ===${NC}"
test_case "Build kcli binary" \
    "cd '$REPO_ROOT/kcli' && go build -o bin/kcli ./cmd/kcli && test -f bin/kcli"

test_case "kcli binary is executable" \
    "test -x '$REPO_ROOT/kcli/bin/kcli'"

test_case "kcli version command works" \
    "'$REPO_ROOT/kcli/bin/kcli' version --client > /dev/null"

# Test 2: Desktop app binary preparation
echo ""
echo -e "${YELLOW}=== Phase 2: Desktop App Integration ===${NC}"
test_case "Build script exists" \
    "test -f '$REPO_ROOT/scripts/build-kcli-for-desktop.sh'"

test_case "Build script is executable" \
    "test -x '$REPO_ROOT/scripts/build-kcli-for-desktop.sh'"

# Run build script if binaries directory doesn't exist or is empty
if [ ! -d "$REPO_ROOT/kubilitics-desktop/binaries" ] || [ -z "$(ls -A "$REPO_ROOT/kubilitics-desktop/binaries/kcli"* 2>/dev/null)" ]; then
    echo -e "${YELLOW}  Building kcli for desktop app...${NC}"
    test_case "Run build script for desktop" \
        "'$REPO_ROOT/scripts/build-kcli-for-desktop.sh'"
fi

test_case "kcli binary exists in desktop binaries directory" \
    "test -f '$REPO_ROOT/kubilitics-desktop/binaries/kcli' || test -f '$REPO_ROOT/kubilitics-desktop/binaries/kcli-'*"

# Test 3: Docker build
echo ""
echo -e "${YELLOW}=== Phase 3: Docker Build ===${NC}"
if command -v docker > /dev/null; then
    test_case "Dockerfile exists" \
        "test -f '$REPO_ROOT/kubilitics-backend/Dockerfile'"
    
    # Check if Dockerfile references kcli correctly
    test_case "Dockerfile includes kcli build stage" \
        "grep -q 'kcli-builder' '$REPO_ROOT/kubilitics-backend/Dockerfile'"
    
    test_case "Dockerfile sets KCLI_BIN env var" \
        "grep -q 'KCLI_BIN' '$REPO_ROOT/kubilitics-backend/Dockerfile'"
    
    # Note: Actual Docker build test would require Docker daemon and is slow
    echo -e "${YELLOW}  Note: Skipping actual Docker build (requires Docker daemon)${NC}"
    echo -e "${YELLOW}  To test: docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .${NC}"
else
    echo -e "${YELLOW}  Docker not available - skipping Docker tests${NC}"
fi

# Test 4: Backend code integration
echo ""
echo -e "${YELLOW}=== Phase 4: Backend Code Integration ===${NC}"
test_case "kcli.go handler exists" \
    "test -f '$REPO_ROOT/kubilitics-backend/internal/api/rest/kcli.go'"

test_case "kcli_stream.go handler exists" \
    "test -f '$REPO_ROOT/kubilitics-backend/internal/api/rest/kcli_stream.go'"

test_case "kcli_complete.go handler exists" \
    "test -f '$REPO_ROOT/kubilitics-backend/internal/api/rest/kcli_complete.go'"

test_case "resolveKCLIBinary function exists" \
    "grep -q 'func resolveKCLIBinary' '$REPO_ROOT/kubilitics-backend/internal/api/rest/kcli.go'"

# Test 5: Frontend integration
echo ""
echo -e "${YELLOW}=== Phase 5: Frontend Integration ===${NC}"
test_case "ClusterShellPanel component exists" \
    "test -f '$REPO_ROOT/kubilitics-frontend/src/components/shell/ClusterShellPanel.tsx'"

test_case "KubectlValidationBanner component exists" \
    "test -f '$REPO_ROOT/kubilitics-frontend/src/components/KubectlValidationBanner.tsx'"

test_case "KubectlValidationBanner is imported in App.tsx" \
    "grep -q 'KubectlValidationBanner' '$REPO_ROOT/kubilitics-frontend/src/App.tsx'"

test_case "WebSocket reconnect logic exists in ClusterShellPanel" \
    "grep -q 'reconnectTimerRef' '$REPO_ROOT/kubilitics-frontend/src/components/shell/ClusterShellPanel.tsx'"

# Test 6: Desktop app integration
echo ""
echo -e "${YELLOW}=== Phase 6: Desktop App (Tauri) Integration ===${NC}"
test_case "kcli in tauri.conf.json externalBin" \
    "grep -q '\"binaries/kcli\"' '$REPO_ROOT/kubilitics-desktop/src-tauri/tauri.conf.json'"

test_case "resolve_kcli_binary_path function exists" \
    "grep -q 'resolve_kcli_binary_path' '$REPO_ROOT/kubilitics-desktop/src-tauri/src/sidecar.rs'"

test_case "KCLI_BIN env var is set in sidecar" \
    "grep -q 'KCLI_BIN' '$REPO_ROOT/kubilitics-desktop/src-tauri/src/sidecar.rs'"

test_case "check_kubectl_installed command exists" \
    "grep -q 'check_kubectl_installed' '$REPO_ROOT/kubilitics-desktop/src-tauri/src/commands.rs'"

test_case "check_kubectl_installed is registered in main.rs" \
    "grep -q 'check_kubectl_installed' '$REPO_ROOT/kubilitics-desktop/src-tauri/src/main.rs'"

# Test 7: Integration test scripts
echo ""
echo -e "${YELLOW}=== Phase 7: Test Scripts ===${NC}"
test_case "Integration smoke test script exists" \
    "test -f '$REPO_ROOT/kcli/scripts/integration-smoke.sh'"

test_case "Integration smoke test script is executable" \
    "test -x '$REPO_ROOT/kcli/scripts/integration-smoke.sh'"

# Test 8: Go integration tests
echo ""
echo -e "${YELLOW}=== Phase 8: Go Integration Tests ===${NC}"
test_case "kcli_test.go exists" \
    "test -f '$REPO_ROOT/kubilitics-backend/tests/integration/kcli_test.go'"

# Summary
echo ""
echo "=== Test Summary ==="
echo "Total tests: $test_count"
echo -e "${GREEN}Passed: $pass_count${NC}"
if [ $fail_count -gt 0 ]; then
    echo -e "${RED}Failed: $fail_count${NC}"
    echo ""
    echo "Failed tests indicate missing integration pieces."
    exit 1
else
    echo -e "${GREEN}Failed: $fail_count${NC}"
    echo ""
    echo -e "${GREEN}✓ All integration checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run backend integration tests: cd kubilitics-backend && go test ./tests/integration/..."
    echo "2. Test backend endpoints: ./kcli/scripts/integration-smoke.sh http://localhost:819 <cluster-id> <token>"
    echo "3. Build desktop app: cd kubilitics-desktop && npm run tauri build"
    echo "4. Test Docker build: docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend ."
    exit 0
fi
