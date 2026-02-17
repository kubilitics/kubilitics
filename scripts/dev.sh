#!/usr/bin/env bash
# One-command dev: build backend, start backend, then frontend (B3.1).
# Backend is built so the running process includes latest code (e.g. topology for Jobs/CronJobs).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Building backend..."
make -C "$ROOT" backend || { echo "Backend build failed."; exit 1; }
echo "Starting Kubilitics backend..."
(cd kubilitics-backend && ./bin/kubilitics-backend) &
BACKEND_PID=$!
trap "kill $BACKEND_PID 2>/dev/null || true" EXIT

sleep 3
echo "Starting Kubilitics frontend..."
cd kubilitics-frontend && npm run dev
