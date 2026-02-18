#!/usr/bin/env bash
# Verify Docker image includes kcli binary
# This script builds Docker image and verifies kcli is included

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKERFILE="$REPO_ROOT/kubilitics-backend/Dockerfile"
IMAGE_NAME="${IMAGE_NAME:-kubilitics-backend-test}"

echo "=== Verifying Docker Build Includes kcli ==="

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE" ]; then
    echo "❌ Error: Dockerfile not found at $DOCKERFILE"
    exit 1
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Error: docker command not found"
    exit 1
fi

# Build Docker image
echo "Building Docker image..."
cd "$REPO_ROOT"
if ! docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .; then
    echo "❌ Error: Docker build failed"
    exit 1
fi

# Verify kcli binary exists in container
echo "Verifying kcli binary in container..."
if ! docker run --rm "$IMAGE_NAME" test -f /usr/local/bin/kcli; then
    echo "❌ Error: kcli binary not found at /usr/local/bin/kcli in container"
    exit 1
fi

# Verify kcli binary is executable
if ! docker run --rm "$IMAGE_NAME" test -x /usr/local/bin/kcli; then
    echo "❌ Error: kcli binary is not executable in container"
    exit 1
fi

# Test kcli version command
echo "Testing kcli version command in container..."
if ! docker run --rm "$IMAGE_NAME" kcli version > /dev/null 2>&1; then
    echo "❌ Error: kcli version command failed in container"
    exit 1
fi

# Verify KCLI_BIN environment variable is set
echo "Verifying KCLI_BIN environment variable..."
KCLI_BIN=$(docker run --rm "$IMAGE_NAME" printenv KCLI_BIN || echo "")
if [ -z "$KCLI_BIN" ]; then
    echo "⚠️  Warning: KCLI_BIN environment variable is not set"
elif [ "$KCLI_BIN" != "/usr/local/bin/kcli" ]; then
    echo "⚠️  Warning: KCLI_BIN is set to '$KCLI_BIN', expected '/usr/local/bin/kcli'"
else
    echo "✅ KCLI_BIN environment variable is correctly set"
fi

# Verify kubectl is also available (required for kcli)
echo "Verifying kubectl is available..."
if ! docker run --rm "$IMAGE_NAME" kubectl version --client > /dev/null 2>&1; then
    echo "⚠️  Warning: kubectl is not available in container (kcli may not work without it)"
else
    echo "✅ kubectl is available in container"
fi

echo ""
echo "✅ Docker build verification passed"
echo "   Image: $IMAGE_NAME"
echo "   kcli binary: /usr/local/bin/kcli"
echo "   KCLI_BIN: ${KCLI_BIN:-not set}"
