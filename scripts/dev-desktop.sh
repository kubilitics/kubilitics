#!/bin/bash
# Desktop development mode: start backend sidecar directly, then Tauri dev mode
# This is faster than build-desktop.sh --dev because it doesn't rebuild the Go binary.
#
# Prerequisites:
#   make backend   # build kubilitics-backend if not already built
#   make kcli      # build kcli if not already built
#
# Usage: ./scripts/dev-desktop.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKEND_BIN="$ROOT/kubilitics-backend/bin/kubilitics-backend"
if [ ! -f "$BACKEND_BIN" ]; then
  echo "ERROR: Backend binary not found. Run: make backend"
  exit 1
fi

# Get the kubeconfig path
KUBECONFIG_PATH="${KUBECONFIG:-$HOME/.kube/config}"
if [ ! -f "$KUBECONFIG_PATH" ]; then
  echo "WARNING: No kubeconfig found at $KUBECONFIG_PATH"
  echo "         Clusters will need to be added manually in the app."
  KUBECONFIG_PATH=""
fi

echo "Starting Kubilitics backend on port 819..."
mkdir -p "$HOME/Library/Application Support/kubilitics"
export KUBILITICS_PORT=819
export KUBILITICS_ALLOWED_ORIGINS="tauri://localhost,tauri://,http://tauri.localhost,http://localhost:5173,http://localhost:819"
export KUBILITICS_DATABASE_PATH="$HOME/Library/Application Support/kubilitics/kubilitics.db"
if [ -n "$KUBECONFIG_PATH" ]; then
  export KUBECONFIG="$KUBECONFIG_PATH"
fi
"$BACKEND_BIN" &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:819/health &>/dev/null; then
    echo "✓ Backend ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Backend did not start within 30 seconds"
    kill "$BACKEND_PID" 2>/dev/null || true
    exit 1
  fi
done

# Copy frontend build if dist is missing or stale
if [ ! -f "$ROOT/kubilitics-desktop/dist/index.html" ]; then
  echo "Building frontend for Tauri..."
  cd "$ROOT/kubilitics-frontend"
  TAURI_BUILD=true npm run build:tauri
  mkdir -p "$ROOT/kubilitics-desktop/dist"
  rm -rf "$ROOT/kubilitics-desktop/dist"
  cp -r dist "$ROOT/kubilitics-desktop/dist"
  cd "$ROOT"
fi

# Prepare desktop npm dependencies
cd "$ROOT/kubilitics-desktop"
if [ ! -d "node_modules" ]; then
  echo "Installing desktop npm dependencies..."
  npm install --silent
fi

echo ""
echo "Starting Tauri dev mode..."
echo "(Backend is managed separately — Tauri will use devUrl: http://localhost:5173)"
echo ""

# Use devUrl (frontend dev server) in dev mode
# Start the frontend dev server in the background
cd "$ROOT/kubilitics-frontend"
npm run dev &
FRONTEND_PID=$!

cd "$ROOT/kubilitics-desktop"
npm run tauri -- dev

# Cleanup on exit
cleanup() {
  echo "Stopping backend and frontend..."
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT
