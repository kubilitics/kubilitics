#!/usr/bin/env bash
# Build kcli binary for desktop app bundling
# This script builds kcli for the current platform and copies it to the desktop app's binaries directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KCLI_DIR="$REPO_ROOT/kcli"
DESKTOP_BINARIES_DIR="$REPO_ROOT/kubilitics-desktop/binaries"

echo "=== Building kcli for Desktop App ==="

# Get target triple
TARGET_TRIPLE=$(rustc --print target-triple 2>/dev/null || echo "")
if [ -z "$TARGET_TRIPLE" ]; then
    echo "Warning: Could not determine target triple. Building for current platform."
fi

# Build kcli
cd "$KCLI_DIR"
echo "Building kcli..."
go build -ldflags="-s -w" -o bin/kcli ./cmd/kcli

if [ ! -f "bin/kcli" ]; then
    echo "Error: kcli binary not found after build"
    exit 1
fi

# Create binaries directory if it doesn't exist
mkdir -p "$DESKTOP_BINARIES_DIR"

# Copy binary with target triple suffix (required by Tauri)
if [ -n "$TARGET_TRIPLE" ]; then
    BINARY_NAME="kcli-$TARGET_TRIPLE"
else
    # Fallback: use platform-specific naming
    case "$(uname -s)" in
        Darwin)
            case "$(uname -m)" in
                arm64) BINARY_NAME="kcli-aarch64-apple-darwin" ;;
                x86_64) BINARY_NAME="kcli-x86_64-apple-darwin" ;;
                *) BINARY_NAME="kcli" ;;
            esac
            ;;
        Linux)
            case "$(uname -m)" in
                x86_64) BINARY_NAME="kcli-x86_64-unknown-linux-gnu" ;;
                aarch64) BINARY_NAME="kcli-aarch64-unknown-linux-gnu" ;;
                *) BINARY_NAME="kcli" ;;
            esac
            ;;
        MINGW*|MSYS*|CYGWIN*)
            BINARY_NAME="kcli-x86_64-pc-windows-msvc.exe"
            ;;
        *)
            BINARY_NAME="kcli"
            ;;
    esac
fi

# Copy binary
cp "bin/kcli" "$DESKTOP_BINARIES_DIR/$BINARY_NAME"
chmod +x "$DESKTOP_BINARIES_DIR/$BINARY_NAME"

echo "✅ kcli built and copied to: $DESKTOP_BINARIES_DIR/$BINARY_NAME"

# Also copy without suffix for development (Tauri will use the suffixed version in production)
cp "bin/kcli" "$DESKTOP_BINARIES_DIR/kcli"
chmod +x "$DESKTOP_BINARIES_DIR/kcli"

echo "✅ Also copied as: $DESKTOP_BINARIES_DIR/kcli (for development)"

echo ""
echo "Next steps:"
echo "1. Build desktop app: cd kubilitics-desktop && npm run tauri build"
echo "2. Or run in dev mode: cd kubilitics-desktop && npm run tauri dev"
