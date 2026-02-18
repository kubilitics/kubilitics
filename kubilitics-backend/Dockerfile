# Multi-stage build for kubilitics-backend + kcli sidecar
# Must be built from the repo root so both kubilitics-backend/ and kcli/ are in context:
#   docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .

# ── Stage 1: Build the backend ──────────────────────────────────────────────
FROM golang:1.24-alpine AS builder
WORKDIR /app
# Copy go module files from kubilitics-backend/ (relative to repo-root context)
COPY kubilitics-backend/go.mod kubilitics-backend/go.sum ./
RUN go mod download
COPY kubilitics-backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kubilitics-backend ./cmd/server

# ── Stage 2: Build kcli ─────────────────────────────────────────────────────
FROM golang:1.24-alpine AS kcli-builder
WORKDIR /kcli
# Copy kcli source from repo-root context
COPY kcli/go.mod kcli/go.sum ./
RUN go mod download
COPY kcli/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kcli ./cmd/kcli

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM alpine:3.19
RUN apk --no-cache add ca-certificates kubectl
WORKDIR /app
COPY --from=builder /kubilitics-backend .
COPY --from=kcli-builder /kcli /usr/local/bin/kcli
RUN chmod +x /usr/local/bin/kcli
# Default data dir; override with KUBILITICS_DATABASE_PATH
RUN mkdir -p /data
EXPOSE 819
EXPOSE 50051
ENV KCLI_BIN=/usr/local/bin/kcli
ENTRYPOINT ["./kubilitics-backend"]
