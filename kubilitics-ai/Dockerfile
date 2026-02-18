# Multi-stage build for kubilitics-ai
# Stage 1: Build
FROM golang:1.24-alpine AS builder

# Install build dependencies (no make needed — build directly with go)
RUN apk add --no-cache git gcc musl-dev

# Set working directory
WORKDIR /build

# Copy go module files first for layer-cache efficiency
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application — strip debug info for a smaller, production binary
RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-s -w" \
    -o bin/kubilitics-ai \
    ./cmd/server/main.go

# Stage 2: Runtime — use the same Alpine series as the builder
FROM alpine:3.21

# Install runtime dependencies
RUN apk add --no-cache ca-certificates

# Create app user
RUN addgroup -g 1000 kubilitics && \
    adduser -D -u 1000 -G kubilitics kubilitics

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/bin/kubilitics-ai /app/

# Copy configuration template
COPY config.example.yaml /app/config.yaml.example

# Create directory for mutable config
RUN mkdir -p /etc/kubilitics && \
    chown -R kubilitics:kubilitics /app

# Switch to non-root user
USER kubilitics

# Expose port 8081 (kubilitics-ai server)
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8081/health || exit 1

# Run the application
ENTRYPOINT ["/app/kubilitics-ai"]
CMD ["--config", "/etc/kubilitics/config.yaml"]
