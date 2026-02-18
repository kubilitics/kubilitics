#!/usr/bin/env bash
# Verify kcli binary builds successfully
# This script builds kcli and verifies it works

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KCLI_DIR="$REPO_ROOT/kcli"

echo "=== Verifying kcli Binary Build ==="

# Check if kcli directory exists
if [ ! -d "$KCLI_DIR" ]; then
    echo "❌ Error: kcli directory not found at $KCLI_DIR"
    exit 1
fi

# Build kcli binary
cd "$KCLI_DIR"
echo "Building kcli binary..."
if ! go build -ldflags="-s -w" -o bin/kcli ./cmd/kcli; then
    echo "❌ Error: kcli build failed"
    exit 1
fi

# Verify binary exists
if [ ! -f "bin/kcli" ]; then
    echo "❌ Error: kcli binary not found after build"
    exit 1
fi

# Verify binary is executable
if [ ! -x "bin/kcli" ]; then
    echo "❌ Error: kcli binary is not executable"
    exit 1
fi

# Test kcli version command
echo "Testing kcli version command..."
if ! ./bin/kcli version > /dev/null 2>&1; then
    echo "❌ Error: kcli version command failed"
    exit 1
fi

# Test kcli help command
echo "Testing kcli help command..."
if ! ./bin/kcli --help > /dev/null 2>&1; then
    echo "❌ Error: kcli help command failed"
    exit 1
fi

# Test basic command (get pods help)
echo "Testing kcli get pods --help..."
if ! ./bin/kcli get pods --help > /dev/null 2>&1; then
    echo "❌ Error: kcli get pods --help command failed"
    exit 1
fi

echo "✅ kcli binary build verification passed"
echo "   Binary location: $KCLI_DIR/bin/kcli"
echo "   Binary size: $(du -h "$KCLI_DIR/bin/kcli" | cut -f1)"
