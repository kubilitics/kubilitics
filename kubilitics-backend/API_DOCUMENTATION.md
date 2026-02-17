# Kubilitics Backend API Documentation

## Overview

The Kubilitics Backend provides a comprehensive REST API and WebSocket interface for Kubernetes cluster management, topology visualization, and real-time monitoring.

**Base URL**: `http://localhost:8080/api/v1`

**API Version**: 1.0.0

## Quick Start

### 1. Start the Backend

```bash
cd kubilitics-backend/cmd/server
go run main.go
```

Or using the compiled binary:

```bash
./kubilitics-server
```

### 2. Check Health

```bash
curl http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy",
  "service": "kubilitics-backend",
  "version": "1.0.0"
}
```

### 3. Add a Cluster

```bash
curl -X POST http://localhost:8080/api/v1/clusters \
  -H "Content-Type: application/json" \
  -d '{
    "kubeconfig_path": "/home/user/.kube/config",
    "context": "my-cluster"
  }'
```

### 4. Get Topology

```bash
curl http://localhost:8080/api/v1/clusters/{cluster-id}/topology?namespace=default
```

## API Reference

### Full OpenAPI/Swagger Documentation

The complete API specification is available in:
- **File**: `/app/kubilitics-backend/api/swagger.yaml`
- **Interactive Docs**: Coming soon (Swagger UI integration)

### Quick API Reference

## Cluster Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters` | List all clusters |
| POST | `/clusters` | Add new cluster |
| GET | `/clusters/{id}` | Get cluster details |
| DELETE | `/clusters/{id}` | Remove cluster |
| GET | `/clusters/{id}/summary` | Get cluster summary stats |

## Topology

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters/{id}/topology` | Get topology graph |
| POST | `/clusters/{clusterId}/topology/export` | Export topology (PNG/PDF/SVG/JSON). **Returns 501** until implemented. |

Query parameters for `/topology`:
- `namespace` (optional): Filter by namespace
- `resource_types` (optional): Comma-separated resource types

## Resources

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters/{id}/resources/{kind}` | List resources by kind |
| GET | `/clusters/{id}/resources/{kind}/{namespace}/{name}` | Get specific resource |
| DELETE | `/clusters/{id}/resources/{kind}/{namespace}/{name}` | Delete resource |
| POST | `/clusters/{id}/apply` | Apply YAML manifest |

Supported resource kinds:
- Pod, Service, Deployment, ReplicaSet, StatefulSet, DaemonSet
- ConfigMap, Secret, PersistentVolume, PersistentVolumeClaim
- Ingress, NetworkPolicy, StorageClass
- Role, RoleBinding, ClusterRole, ClusterRoleBinding, ServiceAccount
- HorizontalPodAutoscaler, PodDisruptionBudget, Job, CronJob

## Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters/{clusterId}/logs/{namespace}/{pod}` | Get pod logs. **Returns 501** until implemented (Phase B1.1). |

Query parameters (when implemented):
- `container`: Container name (required for multi-container pods)
- `follow`: Follow logs (true/false)
- `tail`: Number of lines to tail (default: 100)
- `since`: Duration (e.g., "10m", "1h")

## Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters/{clusterId}/metrics` | Get cluster metrics. **Returns 501** until implemented (Phase B1.3). |
| GET | `/clusters/{clusterId}/metrics/{namespace}/{pod}` | Get pod metrics. **Returns 501** until implemented (Phase B1.3). |

## Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/clusters/{clusterId}/events` | Get Kubernetes events. **Returns 501** until implemented (Phase B1.2). |

Query parameters (when implemented):
- `namespace`: Filter by namespace
- `resource_kind`: Filter by resource kind (e.g., "Pod")
- `resource_name`: Filter by resource name
- `limit`: Max number of events (default: 100)

## WebSocket Endpoints

### Resource Updates

**URL**: `ws://localhost:8080/ws/resources?cluster_id={id}&namespace={ns}`

Receive real-time Kubernetes resource updates.

**Message Format**:
```json
{
  "type": "RESOURCE_ADDED|RESOURCE_UPDATED|RESOURCE_DELETED",
  "cluster_id": "uuid",
  "resource": {
    "kind": "Pod",
    "namespace": "default",
    "name": "nginx-abc",
    "data": { }
  },
  "timestamp": "2024-01-01T10:00:00Z"
}
```

### Topology Updates

**URL**: `ws://localhost:8080/ws/topology?cluster_id={id}`

Receive real-time topology graph updates.

**Message Format**:
```json
{
  "type": "TOPOLOGY_UPDATED",
  "cluster_id": "uuid",
  "changes": {
    "nodes_added": [ ],
    "nodes_updated": [ ],
    "nodes_removed": [ ],
    "edges_added": [ ],
    "edges_removed": [ ]
  },
  "timestamp": "2024-01-01T10:00:00Z"
}
```

## Data Models

### Cluster

```json
{
  "id": "uuid",
  "name": "production-cluster",
  "context": "prod-context",
  "server": "https://api.k8s.example.com",
  "version": "v1.28.0",
  "node_count": 5,
  "namespace_count": 12,
  "created_at": "2024-01-01T10:00:00Z",
  "last_connected": "2024-01-01T11:30:00Z",
  "status": "connected|disconnected|error"
}
```

### Topology Graph

```json
{
  "cluster_id": "uuid",
  "namespace": "default",
  "nodes": [
    {
      "id": "pod-default-nginx",
      "type": "Pod",
      "name": "nginx",
      "namespace": "default",
      "labels": { "app": "nginx" },
      "status": "Running",
      "metadata": { }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "deployment-default-nginx",
      "target": "replicaset-default-nginx",
      "type": "owner",
      "label": "owns"
    }
  ],
  "meta": {
    "node_count": 100,
    "edge_count": 150,
    "generated_at": "2024-01-01T10:00:00Z",
    "layout_seed": "deterministic-seed"
  }
}
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error message description"
}
```

HTTP Status Codes:
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `404`: Not Found
- `500`: Internal Server Error

## Authentication

Currently, the backend authenticates to Kubernetes clusters using kubeconfig files. 

**Planned**: Token-based authentication for multi-user scenarios (Phase 3+).

## Rate Limiting

Rate limiting is not currently enforced but will be added in future versions for production deployments.

## CORS Configuration

CORS is configured to allow:
- Methods: GET, POST, PUT, DELETE, OPTIONS
- Headers: Content-Type, Authorization
- Credentials: Enabled

Configure allowed origins via environment variables:
```bash
KUBILITICS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Examples

### Complete Workflow Example

```bash
# 1. Add a cluster
CLUSTER_ID=$(curl -s -X POST http://localhost:8080/api/v1/clusters \
  -H "Content-Type: application/json" \
  -d '{
    "kubeconfig_path": "~/.kube/config",
    "context": "minikube"
  }' | jq -r '.id')

# 2. Get cluster summary
curl -s http://localhost:8080/api/v1/clusters/$CLUSTER_ID/summary | jq

# 3. Get topology for default namespace
curl -s "http://localhost:8080/api/v1/clusters/$CLUSTER_ID/topology?namespace=default" | jq

# 4. Export topology as PNG
curl -s -X POST http://localhost:8080/api/v1/clusters/$CLUSTER_ID/topology/export \
  -H "Content-Type: application/json" \
  -d '{"format": "png", "namespace": "default"}' \
  --output topology.png

# 5. Get pod logs
curl -s "http://localhost:8080/api/v1/clusters/$CLUSTER_ID/logs/default/nginx-pod?tail=50"

# 6. Get cluster metrics
curl -s http://localhost:8080/api/v1/clusters/$CLUSTER_ID/metrics | jq

# 7. Get events
curl -s "http://localhost:8080/api/v1/clusters/$CLUSTER_ID/events?namespace=default&limit=10" | jq
```

### WebSocket Client Example (JavaScript)

```javascript
// Connect to resource updates
const ws = new WebSocket('ws://localhost:8080/ws/resources?cluster_id=' + clusterId);

ws.onopen = () => {
  console.log('Connected to resource updates');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Resource update:', data.type, data.resource);
  
  switch(data.type) {
    case 'RESOURCE_ADDED':
      // Handle new resource
      break;
    case 'RESOURCE_UPDATED':
      // Handle resource update
      break;
    case 'RESOURCE_DELETED':
      // Handle resource deletion
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from resource updates');
};
```

## Development

### Running Tests

```bash
cd kubilitics-backend
go test ./...
```

### Running Benchmarks

```bash
go test ./internal/topology -bench=. -benchmem
```

### Generating API Docs

To view the Swagger documentation interactively, you can use Swagger UI:

```bash
# Option 1: Docker
docker run -p 8081:8080 -e SWAGGER_JSON=/swagger/swagger.yaml \
  -v $(pwd)/api:/swagger swaggerapi/swagger-ui

# Then visit: http://localhost:8081

# Option 2: NPM
npx swagger-ui-watcher api/swagger.yaml
```

## Configuration

Configuration can be provided via:

1. **Config file**: `config.yaml`
2. **Environment variables**: Prefixed with `KUBILITICS_`

Example `config.yaml`:

```yaml
port: 8080
database:
  type: sqlite
  path: ./kubilitics.db
allowed_origins:
  - http://localhost:3000
  - http://localhost:5173
log_level: info
```

Environment variables:

```bash
KUBILITICS_PORT=8080
KUBILITICS_DATABASE_TYPE=sqlite
KUBILITICS_DATABASE_PATH=./kubilitics.db
KUBILITICS_LOG_LEVEL=info
```

## Troubleshooting

### Common Issues

**Issue**: Cannot connect to cluster
- Check kubeconfig path
- Verify cluster is accessible
- Check network connectivity

**Issue**: WebSocket connection fails
- Ensure backend is running
- Check firewall settings
- Verify cluster_id parameter

**Issue**: Topology is empty
- Verify cluster has resources
- Check namespace filter
- Review backend logs

### Debug Mode

Enable debug logging:

```bash
KUBILITICS_LOG_LEVEL=debug ./kubilitics-server
```

### Logs Location

- Console: stdout/stderr
- File: `/var/log/kubilitics/backend.log` (if configured)

## Production Considerations

### Performance

- The backend can handle multiple clusters simultaneously
- WebSocket connections are pooled and managed efficiently
- Topology generation is optimized for clusters with 10,000+ resources

### Security

- Always use HTTPS in production
- Restrict CORS origins to trusted domains
- Use network policies to limit backend exposure
- Keep kubeconfig files secure with appropriate file permissions

### Monitoring

- Health endpoint: `/health`
- Metrics endpoint: Coming soon (Prometheus integration)
- Structured logging for observability

## Next Steps

1. Integrate with frontend application
2. Add authentication/authorization
3. Implement cluster health monitoring
4. Add Prometheus metrics export
5. Add rate limiting
6. Implement caching layer

## Support

For issues and questions:
- GitHub Issues: https://github.com/kubilitics/kubilitics-backend/issues
- Documentation: https://kubilitics.io/docs

## License

Apache 2.0 - See LICENSE file for details
