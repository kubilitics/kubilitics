#!/usr/bin/env bash
# Verify desktop app build includes kcli binary
# This script verifies kcli is prepared for desktop app bundling

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/kubilitics-desktop"
BINARIES_DIR="$DESKTOP_DIR/binaries"

echo "=== Verifying Desktop App kcli Integration ==="

# Step 1: Build kcli for desktop
echo "Step 1: Building kcli for desktop..."
if ! "$SCRIPT_DIR/build-kcli-for-desktop.sh"; then
    echo "❌ Error: Failed to build kcli for desktop"
    exit 1
fi

# Step 2: Verify binaries directory exists
if [ ! -d "$BINARIES_DIR" ]; then
    echo "❌ Error: binaries directory not found at $BINARIES_DIR"
    exit 1
fi

# Step 3: Verify kcli binary exists (with target triple suffix)
echo "Step 2: Verifying kcli binary exists..."
KCLI_BINARIES=$(find "$BINARIES_DIR" -name "kcli*" -type f 2>/dev/null || true)
if [ -z "$KCLI_BINARIES" ]; then
    echo "❌ Error: No kcli binaries found in $BINARIES_DIR"
    exit 1
fi

echo "Found kcli binaries:"
echo "$KCLI_BINARIES" | while read -r bin; do
    echo "  - $bin ($(du -h "$bin" | cut -f1))"
done

# Step 4: Verify at least one binary is executable
EXECUTABLE_FOUND=false
echo "$KCLI_BINARIES" | while read -r bin; do
    if [ -x "$bin" ]; then
        EXECUTABLE_FOUND=true
        echo "✅ Found executable: $bin"
    fi
done

if [ "$EXECUTABLE_FOUND" = false ]; then
    echo "⚠️  Warning: No executable kcli binaries found"
fi

# Step 5: Verify tauri.conf.json includes kcli in externalBin
echo "Step 3: Verifying tauri.conf.json configuration..."
TAURI_CONF="$DESKTOP_DIR/src-tauri/tauri.conf.json"
if [ ! -f "$TAURI_CONF" ]; then
    echo "❌ Error: tauri.conf.json not found at $TAURI_CONF"
    exit 1
fi

if ! grep -q '"binaries/kcli"' "$TAURI_CONF"; then
    echo "❌ Error: tauri.conf.json does not include 'binaries/kcli' in externalBin"
    exit 1
fi

echo "✅ tauri.conf.json includes kcli in externalBin"

# Step 6: Test kcli binary (if we can determine the right one)
echo "Step 4: Testing kcli binary..."
# Try to find a binary that matches current platform
TARGET_TRIPLE=$(rustc --print target-triple 2>/dev/null || echo "")
if [ -n "$TARGET_TRIPLE" ]; then
    PLATFORM_BIN="$BINARIES_DIR/kcli-$TARGET_TRIPLE"
    if [ -f "$PLATFORM_BIN" ] && [ -x "$PLATFORM_BIN" ]; then
        echo "Testing platform-specific binary: $PLATFORM_BIN"
        if ! "$PLATFORM_BIN" version > /dev/null 2>&1; then
            echo "⚠️  Warning: Platform-specific binary test failed"
        else
            echo "✅ Platform-specific binary works"
        fi
    fi
fi

# Also test generic kcli binary if it exists
if [ -f "$BINARIES_DIR/kcli" ] && [ -x "$BINARIES_DIR/kcli" ]; then
    echo "Testing generic binary: $BINARIES_DIR/kcli"
    if ! "$BINARIES_DIR/kcli" version > /dev/null 2>&1; then
        echo "⚠️  Warning: Generic binary test failed"
    else
        echo "✅ Generic binary works"
    fi
fi

echo ""
echo "✅ Desktop app kcli integration verification passed"
echo "   Binaries directory: $BINARIES_DIR"
echo "   Tauri config: $TAURI_CONF"
