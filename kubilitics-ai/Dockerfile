# Multi-stage build for kubilitics-ai
# Stage 1: Build
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make gcc musl-dev

# Set working directory
WORKDIR /build

# Copy source code
COPY . .

# Build the application
RUN make build

# Stage 2: Runtime
FROM alpine:3.18

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
