# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /kubilitics-backend ./cmd/server

# Runtime stage
FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /kubilitics-backend .
# Default data dir; override with KUBILITICS_DATABASE_PATH
RUN mkdir -p /data
EXPOSE 8080
ENTRYPOINT ["./kubilitics-backend"]
