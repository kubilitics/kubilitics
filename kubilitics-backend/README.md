# Kubilitics Backend

The Kubernetes Operating System - Backend Services

## Overview

Kubilitics backend is a production-grade Kubernetes management platform built in Go. It provides:

- **Exhaustive Resource Discovery**: Discovers all 50+ K8s resource types + CRDs
- **Topology Engine**: Builds complete relationship graphs with deterministic layout
- **Real-Time Updates**: WebSocket streams for live cluster state
- **REST API**: Full CRUD operations for all resources
- **Export Service**: WYSIWYG topology export (PNG, PDF, SVG)

## Architecture

```
┌─────────────────────────────────────────┐
│          API LAYER                      │
│  REST API  │  WebSocket  │  GraphQL     │
├─────────────────────────────────────────┤
│         SERVICE LAYER                   │
│  Cluster │ Topology │ Resource │ Events │
├─────────────────────────────────────────┤
│          DATA LAYER                     │
│  client-go │ Database │ Cache           │
└─────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Go 1.24+
- Kubernetes cluster (kind/k3s/minikube/EKS/GKE/etc.)
- kubeconfig at `~/.kube/config`

### Development

```bash
# Install dependencies
go mod download

# Run backend
go run cmd/server/main.go

# Backend runs on http://localhost:8080
```

### Build

```bash
# Build binary
go build -o bin/kubilitics-backend cmd/server/main.go

# Run
./bin/kubilitics-backend
```

### Configuration

Create `config.yaml`:

```yaml
port: 8080
database_path: ./kubilitics.db
log_level: info
allowed_origins:
  - "*"
```

Or use environment variables:

```bash
export KUBILITICS_PORT=8080
export KUBILITICS_DATABASE_PATH=./kubilitics.db
export KUBILITICS_LOG_LEVEL=info
```

## API Endpoints

### Cluster Management

- `GET /api/v1/clusters` - List configured clusters
- `POST /api/v1/clusters` - Add new cluster
- `GET /api/v1/clusters/:id` - Get cluster details
- `DELETE /api/v1/clusters/:id` - Remove cluster

### Resources

- `GET /api/v1/resources/:type` - List resources by type
- `GET /api/v1/resources/:type/:namespace/:name` - Get resource detail
- `POST /api/v1/resources/:type` - Create resource
- `PUT /api/v1/resources/:type/:namespace/:name` - Update resource
- `DELETE /api/v1/resources/:type/:namespace/:name` - Delete resource

### Topology

- `GET /api/v1/topology` - Get complete topology graph
- `GET /api/v1/topology/:namespace` - Get namespace topology
- `POST /api/v1/topology/export` - Export topology

### Real-Time

- `WS /ws/resources` - WebSocket for resource updates
- `WS /ws/events` - WebSocket for K8s events

## Testing

```bash
# Unit tests
go test ./...

# With coverage
go test -v -race -coverprofile=coverage.out ./...

# Integration tests
go test -v ./test/integration/...
```

## Development notes

**Topology:** After changing backend topology code (e.g. `internal/topology/engine_resource.go`), do a clean rebuild and restart: from repo root run `make clean && make backend`, then start the backend (e.g. `./scripts/restart.sh`). Resource-scoped topology (including Node) uses the running binary’s switch and `ResourceTopologyKinds`; an old or cached binary may return "resource topology not implemented" for kinds that are already supported in source.

## Deployment

### Docker

```bash
# Build image
docker build -t kubilitics-backend .

# Run container
docker run -p 8080:8080 \
  -v ~/.kube/config:/root/.kube/config \
  kubilitics-backend
```

### Helm

```bash
# Install in cluster
helm install kubilitics deployments/helm/kubilitics
```

## License

Apache 2.0
