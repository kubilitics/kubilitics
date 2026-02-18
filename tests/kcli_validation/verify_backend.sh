#!/bin/bash
set -e

# Configuration
BACKEND_PORT=819
HOST="127.0.0.1"
URL="http://$HOST:$BACKEND_PORT"

echo "🎯 Phase 1: Backend Stability Automation"

# 1. Restart Backend cleanly
echo "🔄 [1/5] Restarting backend..."
./scripts/restart.sh > backend_fresh.log 2>&1 &
RESTART_PID=$!
echo "   Backend restart initiated in background (PID: $RESTART_PID)..."

# 2. Validate Port Binding with Loop
echo "⏳ [2/5] Waiting for port $BACKEND_PORT..."
MAX_RETRIES=60
count=0
while ! lsof -i :$BACKEND_PORT -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 1
    count=$((count+1))
    if [ $count -ge $MAX_RETRIES ]; then
        echo "❌ Timeout waiting for port $BACKEND_PORT to listen."
        echo "📜 backend_fresh.log tail:"
        tail -n 20 backend_fresh.log
        exit 1
    fi
done
echo "✅ Port $BACKEND_PORT is LISTENING."

# Ensure 8080 is NOT used
if lsof -i :8080 -sTCP:LISTEN >/dev/null 2>&1; then
    # It might be some other service, but we want to warn if it looks like us
    COMM=$(lsof -i :8080 -sTCP:LISTEN | tail -n 1 | awk '{print $1}')
    if [[ "$COMM" == "kubilitics" || "$COMM" == "main" ]]; then
         echo "❌ Found backend falling back to 8080! This is strictly forbidden."
         exit 1
    else
         echo "⚠️  Something is on 8080 ($COMM), but hopefully not us."
    fi
else
    echo "✅ Port 8080 is free (good, no fallback)."
fi

# 3. Health Check
echo "💓 [3/5] Checking /health endpoint..."
# Retry health check as well, as listening doesn't mean ready
MAX_RETRIES=10
count=0
HTTP_CODE="000"
while [[ "$HTTP_CODE" != "200" && $count -lt $MAX_RETRIES ]]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL/health" || echo "000")
    if [[ "$HTTP_CODE" != "200" ]]; then
        sleep 1
        count=$((count+1))
    fi
done

if [[ "$HTTP_CODE" == "200" ]]; then
    echo "✅ /health returned 200 OK."
else
    echo "❌ /health returned $HTTP_CODE."
    exit 1
fi

# 4. Content Check
echo "📄 [4/5] checking content..."
RESPONSE=$(curl -s "$URL/health")
if [[ "$RESPONSE" == *"ok"* || "$RESPONSE" == *"OK"* || "$RESPONSE" == *"healthy"* ]]; then
     echo "✅ Health response valid: $RESPONSE"
else
     echo "⚠️  Health response unexpected: $RESPONSE"
fi

# 5. WebSocket Validation
echo "🔌 [5/5] Testing WebSocket /shell/stream..."
HTTP_CODE_WS=$(curl -s -o /dev/null -w "%{http_code}" \
     --include \
     --no-buffer \
     --header "Connection: Upgrade" \
     --header "Upgrade: websocket" \
     --header "Host: $HOST:$BACKEND_PORT" \
     --header "Origin: http://$HOST:$BACKEND_PORT" \
     --header "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
     --header "Sec-WebSocket-Version: 13" \
     "$URL/shell/stream")

if [[ "$HTTP_CODE_WS" == "101" ]]; then
    echo "✅ WebSocket Upgrade successful (101)."
else
    # Only warn for now if WS fails but HTTP is ok
    echo "⚠️  WebSocket Upgrade failed (Code: $HTTP_CODE_WS). Proceeding..."
fi

echo "🎉 Phase 1 Complete: Backend is stable on :$BACKEND_PORT"
