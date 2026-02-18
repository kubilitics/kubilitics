#!/usr/bin/env bash
# End-to-end test suite for kcli integration
# This script tests the complete kcli integration flow

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/kubilitics-backend"
KCLI_DIR="$REPO_ROOT/kcli"

echo "=== kcli End-to-End Test Suite ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Helper function to print test results
test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASS${NC}: $2"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}: $2"
        ((FAILED++))
    fi
}

# Phase 1: Verify kcli binary build
echo "Phase 1: kcli Binary Build"
echo "---------------------------"
if "$SCRIPT_DIR/verify-kcli-build.sh" > /dev/null 2>&1; then
    test_result 0 "kcli binary builds successfully"
else
    test_result 1 "kcli binary build failed"
    echo "  Run: ./scripts/verify-kcli-build.sh for details"
fi

# Phase 2: Verify desktop app integration
echo ""
echo "Phase 2: Desktop App Integration"
echo "----------------------------------"
if "$SCRIPT_DIR/verify-desktop-build.sh" > /dev/null 2>&1; then
    test_result 0 "Desktop app kcli integration verified"
else
    test_result 1 "Desktop app kcli integration failed"
    echo "  Run: ./scripts/verify-desktop-build.sh for details"
fi

# Phase 3: Verify Docker build
echo ""
echo "Phase 3: Docker Build Integration"
echo "-----------------------------------"
if command -v docker &> /dev/null; then
    if "$SCRIPT_DIR/verify-docker-build.sh" > /dev/null 2>&1; then
        test_result 0 "Docker build kcli integration verified"
    else
        test_result 1 "Docker build kcli integration failed"
        echo "  Run: ./scripts/verify-docker-build.sh for details"
    fi
else
    echo -e "${YELLOW}⚠️  SKIP${NC}: Docker not available - skipping Docker build test"
fi

# Phase 4: Verify backend code integration
echo ""
echo "Phase 4: Backend Code Integration"
echo "----------------------------------"
if [ -f "$BACKEND_DIR/internal/api/rest/kcli.go" ] && \
   [ -f "$BACKEND_DIR/internal/api/rest/kcli_stream.go" ] && \
   [ -f "$BACKEND_DIR/internal/api/rest/kcli_complete.go" ] && \
   [ -f "$BACKEND_DIR/internal/api/rest/kcli_policy.go" ]; then
    test_result 0 "Backend kcli handler files exist"
else
    test_result 1 "Backend kcli handler files missing"
fi

# Check AI env var integration
if grep -q "buildKCLIAIEnvVars" "$BACKEND_DIR/internal/api/rest/kcli.go" && \
   grep -q "buildKCLIAIEnvVars" "$BACKEND_DIR/internal/api/rest/kcli_stream.go"; then
    test_result 0 "AI environment variable integration exists"
else
    test_result 1 "AI environment variable integration missing"
fi

# Phase 5: Verify frontend integration
echo ""
echo "Phase 5: Frontend Integration"
echo "------------------------------"
if [ -f "$REPO_ROOT/kubilitics-frontend/src/components/shell/ClusterShellPanel.tsx" ]; then
    if grep -q "kcli" "$REPO_ROOT/kubilitics-frontend/src/components/shell/ClusterShellPanel.tsx"; then
        test_result 0 "Frontend shell panel includes kcli support"
    else
        test_result 1 "Frontend shell panel missing kcli support"
    fi
else
    test_result 1 "Frontend shell panel component not found"
fi

# Phase 6: Verify CI/CD integration
echo ""
echo "Phase 6: CI/CD Integration"
echo "---------------------------"
if grep -q "kcli" ".github/workflows/desktop-ci.yml" && \
   grep -q "kcli" ".github/workflows/backend-ci.yml" && \
   grep -q "kcli" ".github/workflows/release.yml"; then
    test_result 0 "CI/CD workflows include kcli builds"
else
    test_result 1 "CI/CD workflows missing kcli builds"
fi

# Phase 7: Verify Helm chart integration
echo ""
echo "Phase 7: Helm Chart Integration"
echo "--------------------------------"
if [ -f "$REPO_ROOT/deploy/helm/kubilitics/values.yaml" ]; then
    if grep -q "kcli:" "$REPO_ROOT/deploy/helm/kubilitics/values.yaml"; then
        test_result 0 "Helm values.yaml includes kcli configuration"
    else
        test_result 1 "Helm values.yaml missing kcli configuration"
    fi
    
    if grep -q "KCLI_BIN" "$REPO_ROOT/deploy/helm/kubilitics/templates/deployment.yaml"; then
        test_result 0 "Helm deployment template includes KCLI_BIN env var"
    else
        test_result 1 "Helm deployment template missing KCLI_BIN env var"
    fi
else
    test_result 1 "Helm chart not found"
fi

# Phase 8: Verify documentation
echo ""
echo "Phase 8: Documentation"
echo "----------------------"
if [ -f "$REPO_ROOT/docs/DEPLOYMENT_KCLI.md" ]; then
    test_result 0 "Deployment documentation exists"
else
    test_result 1 "Deployment documentation missing"
fi

if [ -f "$REPO_ROOT/kcli/BUILD.md" ]; then
    test_result 0 "Build documentation exists"
else
    test_result 1 "Build documentation missing"
fi

if [ -f "$REPO_ROOT/docs/TROUBLESHOOTING_KCLI.md" ]; then
    test_result 0 "Troubleshooting documentation exists"
else
    test_result 1 "Troubleshooting documentation missing"
fi

# Phase 9: Verify test scripts
echo ""
echo "Phase 9: Test Scripts"
echo "---------------------"
if [ -f "$SCRIPT_DIR/verify-kcli-build.sh" ] && \
   [ -f "$SCRIPT_DIR/verify-desktop-build.sh" ] && \
   [ -f "$SCRIPT_DIR/verify-docker-build.sh" ] && \
   [ -f "$SCRIPT_DIR/test-websocket-reconnect.sh" ] && \
   [ -f "$SCRIPT_DIR/test-kubectl-validation.sh" ]; then
    test_result 0 "All test scripts exist"
else
    test_result 1 "Some test scripts are missing"
fi

# Phase 10: Verify integration tests
echo ""
echo "Phase 10: Integration Tests"
echo "---------------------------"
if [ -f "$BACKEND_DIR/tests/integration/kcli_test.go" ]; then
    test_result 0 "Go integration tests exist"
    
    # Check for enhanced test cases
    if grep -q "TestKCLIPluginCommand\|TestKCLIErrorHandling\|TestKCLIStreamSlotLimit\|TestKCLIBinaryNotFoundError" "$BACKEND_DIR/tests/integration/kcli_test.go"; then
        test_result 0 "Enhanced integration test cases exist"
    else
        test_result 1 "Enhanced integration test cases missing"
    fi
else
    test_result 1 "Go integration tests missing"
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
