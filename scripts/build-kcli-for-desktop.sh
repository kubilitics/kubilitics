#!/usr/bin/env bash
# Download kcli binaries for desktop app bundling
# This script downloads kcli binaries for all platforms and copies them to the desktop app's binaries directory
# Option: Set KCLI_BUILD_FROM_SOURCE=1 to build from source instead (requires kcli directory)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KCLI_DIR="$REPO_ROOT/kcli"
DESKTOP_BINARIES_DIR="$REPO_ROOT/kubilitics-desktop/binaries"
KCLI_VERSION="${KCLI_VERSION:-v1.0.0}"

echo "=== Downloading kcli binaries for Desktop App ==="
echo "kcli version: $KCLI_VERSION"

# Create binaries directory if it doesn't exist
mkdir -p "$DESKTOP_BINARIES_DIR"

if [ "${KCLI_BUILD_FROM_SOURCE:-0}" = "1" ]; then
    echo "Building kcli from source (KCLI_BUILD_FROM_SOURCE=1)..."
    if [ ! -d "$KCLI_DIR" ]; then
        echo "Error: kcli directory not found at $KCLI_DIR"
        exit 1
    fi
    cd "$KCLI_DIR"
    go build -ldflags="-s -w" -o bin/kcli ./cmd/kcli
    
    # Copy for current platform only
    TARGET_TRIPLE=$(rustc --print target-triple 2>/dev/null || echo "")
    if [ -n "$TARGET_TRIPLE" ]; then
        cp "bin/kcli" "$DESKTOP_BINARIES_DIR/kcli-$TARGET_TRIPLE"
        chmod +x "$DESKTOP_BINARIES_DIR/kcli-$TARGET_TRIPLE"
    fi
    cp "bin/kcli" "$DESKTOP_BINARIES_DIR/kcli"
    chmod +x "$DESKTOP_BINARIES_DIR/kcli"
    echo "✅ Built kcli from source"
else
    echo "Downloading kcli binaries from GitHub releases..."
    
    # Download binaries for all platforms (required by Tauri)
    echo "Downloading macOS binaries..."
    curl -fsSL "https://github.com/vellankikoti/kcli/releases/download/${KCLI_VERSION}/kcli-darwin-amd64" \
        -o "$DESKTOP_BINARIES_DIR/kcli-x86_64-apple-darwin"
    curl -fsSL "https://github.com/vellankikoti/kcli/releases/download/${KCLI_VERSION}/kcli-darwin-arm64" \
        -o "$DESKTOP_BINARIES_DIR/kcli-aarch64-apple-darwin"
    
    echo "Downloading Linux binaries..."
    curl -fsSL "https://github.com/vellankikoti/kcli/releases/download/${KCLI_VERSION}/kcli-linux-amd64" \
        -o "$DESKTOP_BINARIES_DIR/kcli-x86_64-unknown-linux-gnu"
    curl -fsSL "https://github.com/vellankikoti/kcli/releases/download/${KCLI_VERSION}/kcli-linux-arm64" \
        -o "$DESKTOP_BINARIES_DIR/kcli-aarch64-unknown-linux-gnu"
    
    echo "Downloading Windows binary..."
    curl -fsSL "https://github.com/vellankikoti/kcli/releases/download/${KCLI_VERSION}/kcli-windows-amd64.exe" \
        -o "$DESKTOP_BINARIES_DIR/kcli-x86_64-pc-windows-msvc.exe"
    
    chmod +x "$DESKTOP_BINARIES_DIR"/kcli-*
    
    echo "✅ Downloaded kcli binaries for all platforms"
fi

echo ""
echo "kcli binaries ready in: $DESKTOP_BINARIES_DIR"
echo ""
echo "Next steps:"
echo "1. Build desktop app: cd kubilitics-desktop && npm run tauri build"
echo "2. Or run in dev mode: cd kubilitics-desktop && npm run tauri dev"
