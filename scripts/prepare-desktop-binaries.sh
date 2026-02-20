#!/bin/bash
# Prepare desktop binaries: copy compiled Go binaries to Tauri bundle directory
# Run this before `tauri build` or `tauri dev` to ensure up-to-date binaries are bundled.
#
# Usage: ./scripts/prepare-desktop-binaries.sh
#        ./scripts/prepare-desktop-binaries.sh --skip-ai  (skip AI binary if not needed)

set -euo pipefail

SKIP_AI=false
for arg in "$@"; do
  [[ "$arg" == "--skip-ai" ]] && SKIP_AI=true
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARIES_DIR="$ROOT/kubilitics-desktop/src-tauri/binaries"

# Detect host target triple from rustc
TRIPLE=$(rustc -vV 2>/dev/null | grep '^host:' | awk '{print $2}')
if [ -z "$TRIPLE" ]; then
  echo "ERROR: rustc not found. Install Rust: https://rustup.rs"
  exit 1
fi
echo "Host triple: $TRIPLE"
mkdir -p "$BINARIES_DIR"

copy_binary() {
  local name="$1"
  local src="$2"
  local dst="$BINARIES_DIR/${name}-${TRIPLE}"

  if [ -f "$src" ]; then
    cp "$src" "$dst"
    chmod +x "$dst"
    echo "✓ ${name}-${TRIPLE}"
  else
    echo "WARNING: $src not found — $name will not be bundled"
    echo "         Run: make ${name/kubilitics-/}"
    return 1
  fi
}

ERRORS=0

# kubilitics-backend (required)
copy_binary "kubilitics-backend" "$ROOT/kubilitics-backend/bin/kubilitics-backend" || ERRORS=$((ERRORS+1))

# kcli (required for kubectl-style operations)
copy_binary "kcli" "$ROOT/kcli/bin/kcli" || ERRORS=$((ERRORS+1))

# kubilitics-ai (optional)
if [ "$SKIP_AI" = "false" ]; then
  copy_binary "kubilitics-ai" "$ROOT/kubilitics-ai/bin/kubilitics-ai" || true  # Not fatal
fi

echo ""
echo "Binaries in $BINARIES_DIR:"
ls -lh "$BINARIES_DIR/" 2>/dev/null || echo "(empty)"

# Remove macOS quarantine attributes (if any — common when downloading from CI artifacts)
if command -v xattr &>/dev/null; then
  xattr -d com.apple.quarantine "$BINARIES_DIR/"* 2>/dev/null || true
fi

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "ERROR: $ERRORS required binary/binaries missing. Build them first."
  echo "  make backend   # build kubilitics-backend"
  echo "  make kcli      # build kcli"
  exit 1
fi

echo ""
echo "Binaries ready for Tauri bundling."
