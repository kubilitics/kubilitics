# Build stage for backend
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kubilitics-backend ./cmd/server

# Build kcli binary
# Note: This Dockerfile should be built from the repo root with:
# docker build -f kubilitics-backend/Dockerfile -t kubilitics-backend .
FROM golang:1.24-alpine AS kcli-builder
WORKDIR /kcli
# Copy kcli source from repo root context
COPY kcli/go.mod kcli/go.sum ./
RUN go mod download
COPY kcli .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kcli ./cmd/kcli

# Runtime stage
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
