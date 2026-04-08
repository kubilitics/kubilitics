# Distributed Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click "Enable Tracing" deploys an in-cluster trace agent + OTel auto-instrumentation, user picks deployments, real traces flow into Kubilitics UI.

**Architecture:** Pull-based. A `kubilitics-trace-agent` pod runs inside the cluster receiving OTLP traces and storing in SQLite. Kubilitics desktop backend polls the agent via K8s service proxy every 15s. Frontend shows traces from local cache.

**Tech Stack:** Go 1.25, OTel Collector libraries, SQLite/sqlx, K8s client-go (service proxy), Helm client, React/TypeScript, Tailwind CSS.

---

## File Structure

```
kubilitics-trace-agent/                    (NEW — separate Go module)
  go.mod
  go.sum
  cmd/agent/main.go                        Main entry point
  internal/receiver/receiver.go            OTLP gRPC+HTTP receiver
  internal/store/store.go                  SQLite storage (adapted from backend)
  internal/store/migrations.go             Schema creation
  internal/api/api.go                      REST query API on :9417
  Dockerfile                               Multi-stage build

kubilitics-backend/
  internal/otel/puller.go                  (NEW) Polls trace-agent via K8s service proxy
  internal/otel/agent_manifests.go         (NEW) YAML manifests for trace-agent + Instrumentation CRs
  internal/api/rest/tracing.go             (NEW) /tracing/* HTTP handlers
  internal/api/rest/handler.go             (MODIFY) Register tracing routes
  cmd/server/main.go                       (MODIFY) Wire puller + tracing handler

kubilitics-frontend/
  src/components/traces/TracingSetup.tsx    (NEW) Enable Tracing wizard
  src/components/traces/DeploymentPicker.tsx (NEW) Select deployments to instrument
  src/components/traces/TracingStatus.tsx   (NEW) Agent health badge
  src/components/traces/TraceList.tsx       (MODIFY) Show setup or status based on agent state
  src/services/api/tracing.ts              (NEW) API client for /tracing/* endpoints
  src/pages/TracesPage.tsx                 (MODIFY) Integrate setup flow
```

---

### Task 1: Trace Agent — Go Module + SQLite Store

Create the `kubilitics-trace-agent` Go module with SQLite storage adapted from the existing backend OTel store.

**Files:**
- Create: `kubilitics-trace-agent/go.mod`
- Create: `kubilitics-trace-agent/internal/store/migrations.go`
- Create: `kubilitics-trace-agent/internal/store/store.go`

- [ ] **Step 1: Initialize Go module**

```bash
mkdir -p kubilitics-trace-agent/cmd/agent kubilitics-trace-agent/internal/store kubilitics-trace-agent/internal/receiver kubilitics-trace-agent/internal/api
cd kubilitics-trace-agent
go mod init github.com/kubilitics/kubilitics-trace-agent
go get github.com/jmoiron/sqlx
go get modernc.org/sqlite
```

- [ ] **Step 2: Create migrations.go — schema for spans and traces tables**

```go
// kubilitics-trace-agent/internal/store/migrations.go
package store

const schema = `
CREATE TABLE IF NOT EXISTS spans (
    span_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_span_id TEXT DEFAULT '',
    service_name TEXT DEFAULT '',
    operation_name TEXT DEFAULT '',
    span_kind TEXT DEFAULT '',
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    duration_ns INTEGER NOT NULL,
    status_code TEXT DEFAULT 'UNSET',
    status_message TEXT DEFAULT '',
    http_method TEXT DEFAULT '',
    http_url TEXT DEFAULT '',
    http_status_code INTEGER,
    http_route TEXT DEFAULT '',
    db_system TEXT DEFAULT '',
    db_statement TEXT DEFAULT '',
    k8s_pod_name TEXT DEFAULT '',
    k8s_namespace TEXT DEFAULT '',
    k8s_node_name TEXT DEFAULT '',
    k8s_container TEXT DEFAULT '',
    k8s_deployment TEXT DEFAULT '',
    attributes TEXT DEFAULT '{}',
    events TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
CREATE INDEX IF NOT EXISTS idx_spans_start ON spans(start_time);

CREATE TABLE IF NOT EXISTS traces (
    trace_id TEXT PRIMARY KEY,
    root_service TEXT DEFAULT '',
    root_operation TEXT DEFAULT '',
    start_time INTEGER NOT NULL,
    duration_ns INTEGER NOT NULL DEFAULT 0,
    span_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    service_count INTEGER NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'OK',
    services TEXT DEFAULT '[]',
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_traces_start ON traces(start_time);
CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(root_service);
CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(status);
`

func Migrate(db *sqlx.DB) error {
    _, err := db.Exec(schema)
    return err
}
```

- [ ] **Step 3: Create store.go — adapted from kubilitics-backend/internal/otel/store.go**

Adapt the existing store with these methods:
- `NewStore(dbPath string) (*Store, error)` — opens SQLite, runs migrations
- `InsertSpans(ctx, spans []Span) error` — batch insert
- `InsertTraceSummary(ctx, t *TraceSummary) error` — upsert
- `QueryTraces(ctx, q TraceQuery) ([]TraceSummary, error)` — list with filters
- `GetTrace(ctx, traceID string) (*TraceDetail, error)` — single trace with spans
- `GetServiceMap(ctx, from, to int64) (*ServiceMap, error)` — service dependency graph
- `GetHealth(ctx) (*HealthInfo, error)` — span count + oldest span
- `PruneOlderThan(ctx, cutoffNs int64) error` — retention cleanup
- `GetTracesSince(ctx, sinceNs int64, limit int) ([]TraceSummary, error)` — for puller polling

The types (Span, TraceSummary, TraceDetail, ServiceMap, TraceQuery) should match the existing backend types exactly so the puller can store them directly.

- [ ] **Step 4: Verify build**

```bash
cd kubilitics-trace-agent && go build ./internal/store/
```

- [ ] **Step 5: Commit**

```bash
git add -f kubilitics-trace-agent/
git commit -m "feat(trace-agent): Go module + SQLite store with spans/traces schema"
```

---

### Task 2: Trace Agent — OTLP Receiver + REST Query API

Add the OTLP receiver (accepts traces from apps) and REST query API (serves traces to Kubilitics desktop).

**Files:**
- Create: `kubilitics-trace-agent/internal/receiver/receiver.go`
- Create: `kubilitics-trace-agent/internal/api/api.go`
- Create: `kubilitics-trace-agent/cmd/agent/main.go`
- Create: `kubilitics-trace-agent/Dockerfile`

- [ ] **Step 1: Create receiver.go — OTLP HTTP JSON receiver**

Receives OTLP/HTTP JSON on :4318 (same format as the existing backend receiver in `internal/otel/receiver.go`). Parse `OTLPTraceRequest`, extract spans, store via the store.

Port the `ProcessTraces` logic from `kubilitics-backend/internal/otel/receiver.go` but simplified:
- No rate limiting (single-cluster agent, not multi-tenant)
- No cluster ID fallback chain (agent knows its own cluster)
- Keep span enrichment (resource attributes → span fields)

Also add a simple gRPC receiver on :4317 using `go.opentelemetry.io/collector/receiver/otlpreceiver` if feasible, or just document that HTTP :4318 is the primary receiver and gRPC :4317 is future.

- [ ] **Step 2: Create api.go — REST query API on :9417**

```go
// kubilitics-trace-agent/internal/api/api.go
package api

// Handler serves trace data to Kubilitics desktop via K8s service proxy.
// All endpoints return JSON.
type Handler struct {
    store *store.Store
}

func NewHandler(s *store.Store) *Handler { return &Handler{store: s} }

func (h *Handler) SetupRoutes(mux *http.ServeMux) {
    mux.HandleFunc("GET /traces", h.ListTraces)
    mux.HandleFunc("GET /traces/{traceId}", h.GetTrace)
    mux.HandleFunc("GET /services", h.GetServiceMap)
    mux.HandleFunc("GET /health", h.GetHealth)
    mux.HandleFunc("GET /traces/since", h.GetTracesSince)  // For puller polling
}
```

Implement each handler:
- `ListTraces` — parses query params (limit, from, to, service, status), calls `store.QueryTraces`
- `GetTrace` — path param `traceId`, calls `store.GetTrace`
- `GetServiceMap` — query params (from, to), calls `store.GetServiceMap`
- `GetHealth` — calls `store.GetHealth`
- `GetTracesSince` — query param `since` (unix nanoseconds), returns traces newer than timestamp. Used by the puller for incremental sync.

- [ ] **Step 3: Create cmd/agent/main.go — entry point**

```go
package main

// Starts:
// 1. SQLite store with 24h pruning goroutine (every hour)
// 2. OTLP HTTP receiver on :4318
// 3. REST query API on :9417
// 4. Health check on :9417/health
// Graceful shutdown on SIGTERM/SIGINT.
```

- [ ] **Step 4: Create Dockerfile**

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /trace-agent ./cmd/agent/

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /trace-agent /usr/local/bin/trace-agent
EXPOSE 4317 4318 9417
ENTRYPOINT ["trace-agent"]
```

- [ ] **Step 5: Verify full build**

```bash
cd kubilitics-trace-agent && go build ./cmd/agent/
```

- [ ] **Step 6: Commit**

```bash
git add -f kubilitics-trace-agent/
git commit -m "feat(trace-agent): OTLP receiver + REST query API + Dockerfile"
```

---

### Task 3: Agent Manifests — K8s YAML for Deployment + Service

Create the K8s manifests that Kubilitics deploys into the user's cluster.

**Files:**
- Create: `kubilitics-backend/internal/otel/agent_manifests.go`

- [ ] **Step 1: Create agent_manifests.go with embedded YAML**

```go
package otel

// AgentManifestYAML returns the K8s YAML for deploying the trace agent.
// Image tag is parameterized.
func AgentManifestYAML(imageTag string) string {
    return fmt.Sprintf(`
apiVersion: v1
kind: Namespace
metadata:
  name: kubilitics-system
  labels:
    app.kubernetes.io/managed-by: kubilitics
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubilitics-trace-agent
  namespace: kubilitics-system
  labels:
    app: kubilitics-trace-agent
    app.kubernetes.io/managed-by: kubilitics
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kubilitics-trace-agent
  template:
    metadata:
      labels:
        app: kubilitics-trace-agent
    spec:
      containers:
      - name: agent
        image: ghcr.io/kubilitics/trace-agent:%s
        ports:
        - containerPort: 4317
          name: otlp-grpc
        - containerPort: 4318
          name: otlp-http
        - containerPort: 9417
          name: query-api
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "200m"
        volumeMounts:
        - name: data
          mountPath: /data
        env:
        - name: DB_PATH
          value: /data/traces.db
        livenessProbe:
          httpGet:
            path: /health
            port: 9417
          initialDelaySeconds: 5
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 9417
          initialDelaySeconds: 3
          periodSeconds: 10
      volumes:
      - name: data
        emptyDir:
          sizeLimit: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: kubilitics-trace-agent
  namespace: kubilitics-system
  labels:
    app: kubilitics-trace-agent
    app.kubernetes.io/managed-by: kubilitics
spec:
  selector:
    app: kubilitics-trace-agent
  ports:
  - name: otlp-grpc
    port: 4317
    targetPort: 4317
  - name: otlp-http
    port: 4318
    targetPort: 4318
  - name: query-api
    port: 9417
    targetPort: 9417
`, imageTag)
}

// InstrumentationCRsYAML returns OTel Instrumentation CRs for auto-instrumentation.
// These configure the OTel Operator to inject the appropriate SDK into annotated pods.
func InstrumentationCRsYAML() string {
    return `
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: kubilitics-auto
  namespace: kubilitics-system
spec:
  exporter:
    endpoint: http://kubilitics-trace-agent.kubilitics-system:4318
  env:
  - name: OTEL_EXPORTER_OTLP_PROTOCOL
    value: http/json
  propagators:
  - tracecontext
  - baggage
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:latest
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:latest
  go:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-go:latest
  dotnet:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-dotnet:latest
`
}

// CleanupManifestNames returns the resource names/namespaces for deletion.
func CleanupManifestNames() (namespace, deploymentName, serviceName, instrumentationName string) {
    return "kubilitics-system", "kubilitics-trace-agent", "kubilitics-trace-agent", "kubilitics-auto"
}
```

- [ ] **Step 2: Verify build**

```bash
cd kubilitics-backend && go build ./internal/otel/
```

- [ ] **Step 3: Commit**

```bash
git add kubilitics-backend/internal/otel/agent_manifests.go
git commit -m "feat: trace-agent K8s manifests + Instrumentation CRs"
```

---

### Task 4: Backend — Trace Puller (polls agent via K8s service proxy)

Create the puller service that polls the in-cluster trace-agent for new traces.

**Files:**
- Create: `kubilitics-backend/internal/otel/puller.go`
- Modify: `kubilitics-backend/cmd/server/main.go`

- [ ] **Step 1: Create puller.go**

```go
package otel

// TracePuller polls the kubilitics-trace-agent inside the cluster via
// K8s service proxy and stores traces in the local SQLite.
//
// Service proxy URL pattern:
// GET /api/v1/namespaces/kubilitics-system/services/kubilitics-trace-agent:9417/proxy/traces/since?since=<ns>
//
// This works with any kubeconfig — local, EKS, AKS, GKE — because it
// goes through the K8s API server, not direct pod networking.
type TracePuller struct {
    store     *Store
    client    kubernetes.Interface  // from cluster service
    clusterID string
    stopCh    chan struct{}
    lastPull  atomic.Int64  // unix nanoseconds of last successful pull
}
```

Key methods:
- `NewTracePuller(store *Store) *TracePuller`
- `Start(client kubernetes.Interface, clusterID string)` — starts polling goroutine (every 15s)
- `Stop(clusterID string)` — stops polling
- `pullOnce(ctx context.Context) error` — single poll cycle:
  1. Build URL: `/api/v1/namespaces/kubilitics-system/services/kubilitics-trace-agent:9417/proxy/traces/since?since=<lastPull>&limit=500`
  2. Make request via `client.Discovery().RESTClient().Get().AbsPath(url).Do(ctx)`
  3. Parse JSON response into `[]TraceSummary`
  4. For each new trace, fetch full detail: `/proxy/traces/<traceId>`
  5. Store spans + trace summary in local SQLite via existing `store.InsertSpans` and `store.InsertTraceSummary`
  6. Update `lastPull` timestamp
- `IsAgentReachable(ctx context.Context, client kubernetes.Interface) bool` — health check via `/proxy/health`

The puller should implement `ClusterLifecycleHook` so it starts/stops with cluster connect/disconnect.

- [ ] **Step 2: Wire puller into main.go**

After the existing OTel setup code (~line 628), add:

```go
tracePuller := otel.NewTracePuller(otelStore)
handler.SetLifecycleHook(tracePuller)
```

- [ ] **Step 3: Verify build**

```bash
cd kubilitics-backend && go build ./cmd/server/
```

- [ ] **Step 4: Commit**

```bash
git add kubilitics-backend/internal/otel/puller.go kubilitics-backend/cmd/server/main.go
git commit -m "feat: trace puller — polls in-cluster agent via K8s service proxy"
```

---

### Task 5: Backend — Tracing API Handlers

Create the REST API for enable/disable/instrument/status.

**Files:**
- Create: `kubilitics-backend/internal/api/rest/tracing.go`
- Modify: `kubilitics-backend/internal/api/rest/handler.go` (add routes)

- [ ] **Step 1: Create tracing.go with all handlers**

```go
package rest

// TracingHandler manages the tracing lifecycle for a cluster.
type TracingHandler struct {
    clusterService service.ClusterService
    helmClient     helm.Client    // from addon system
    puller         *otel.TracePuller
}
```

Handlers:

**`POST /clusters/{clusterId}/tracing/enable`**
1. Get K8s client for cluster
2. Create namespace `kubilitics-system` (if not exists) — use `client.CoreV1().Namespaces().Create()`
3. Check cert-manager: `client.ApiextensionsV1().CustomResourceDefinitions().Get(ctx, "certificates.cert-manager.io", ...)`. If not found, install via Helm (`jetstack/cert-manager` chart).
4. Check OTel Operator: look for CRD `instrumentations.opentelemetry.io`. If not found, install via Helm (`open-telemetry/opentelemetry-operator` chart).
5. Apply trace-agent manifests via `client.ApplyYAML(ctx, AgentManifestYAML("v0.2.0"))`
6. Apply Instrumentation CRs via `client.ApplyYAML(ctx, InstrumentationCRsYAML())`
7. Wait for agent pod ready (poll for 60s)
8. Start puller: `puller.Start(client, clusterID)`
9. Return: `{"status": "enabled", "message": "Tracing infrastructure deployed"}`

**`GET /clusters/{clusterId}/tracing/status`**
1. Check if trace-agent Deployment exists in `kubilitics-system`
2. Check agent pod health via service proxy `/health`
3. List deployments across all namespaces, check which have OTel annotations
4. Return `TracingStatus` struct

**`POST /clusters/{clusterId}/tracing/instrument`**
1. Parse request body: `{deployments: [{name, namespace}]}`
2. For each deployment:
   a. Get deployment spec to detect container image language
   b. Add annotation `instrumentation.opentelemetry.io/inject-<lang>: "kubilitics-auto"`
   c. Patch deployment via `client.AppsV1().Deployments(ns).Patch()`
   d. Trigger rollout restart by updating pod template annotation `kubectl.kubernetes.io/restartedAt`
3. Return: `{"instrumented": ["ns/name", ...], "restarting": true}`

**`POST /clusters/{clusterId}/tracing/disable`**
1. Stop puller
2. List deployments with OTel annotations, remove annotations, trigger restart
3. Delete Instrumentation CR
4. Delete trace-agent Deployment + Service
5. Return: `{"status": "disabled"}`

Language detection helper:
```go
func detectLanguage(image string) string {
    image = strings.ToLower(image)
    switch {
    case strings.Contains(image, "java") || strings.Contains(image, "jdk") || strings.Contains(image, "spring") || strings.Contains(image, "maven") || strings.Contains(image, "gradle"):
        return "java"
    case strings.Contains(image, "node") || strings.Contains(image, "npm") || strings.Contains(image, "yarn") || strings.Contains(image, "next") || strings.Contains(image, "express"):
        return "nodejs"
    case strings.Contains(image, "python") || strings.Contains(image, "pip") || strings.Contains(image, "django") || strings.Contains(image, "flask") || strings.Contains(image, "fastapi"):
        return "python"
    case strings.Contains(image, "golang") || strings.Contains(image, "go"):
        return "go"
    case strings.Contains(image, "dotnet") || strings.Contains(image, "aspnet") || strings.Contains(image, "csharp"):
        return "dotnet"
    default:
        return "java" // Most common, safest default
    }
}
```

- [ ] **Step 2: Register routes in handler.go**

In `SetupRoutes`, add:
```go
// Tracing lifecycle
apiRouter.HandleFunc("/clusters/{clusterId}/tracing/enable", h.tracingHandler.EnableTracing).Methods("POST")
apiRouter.HandleFunc("/clusters/{clusterId}/tracing/status", h.tracingHandler.GetTracingStatus).Methods("GET")
apiRouter.HandleFunc("/clusters/{clusterId}/tracing/instrument", h.tracingHandler.InstrumentDeployments).Methods("POST")
apiRouter.HandleFunc("/clusters/{clusterId}/tracing/disable", h.tracingHandler.DisableTracing).Methods("POST")
```

- [ ] **Step 3: Wire TracingHandler in main.go**

```go
tracingHandler := rest.NewTracingHandler(clusterService, helmClient, tracePuller)
handler.SetTracingHandler(tracingHandler)
```

- [ ] **Step 4: Verify build**

```bash
cd kubilitics-backend && go build ./cmd/server/
```

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/api/rest/tracing.go kubilitics-backend/internal/api/rest/handler.go kubilitics-backend/cmd/server/main.go
git commit -m "feat: tracing API — enable/disable/instrument/status endpoints"
```

---

### Task 6: Frontend — Tracing API Client

Create the TypeScript API client for the tracing endpoints.

**Files:**
- Create: `kubilitics-frontend/src/services/api/tracing.ts`

- [ ] **Step 1: Create tracing.ts**

```typescript
import { backendRequest } from './client';

export interface TracingStatus {
  enabled: boolean;
  agent_healthy: boolean;
  agent_span_count: number;
  cert_manager_installed: boolean;
  otel_operator_installed: boolean;
  instrumented_deployments: string[];
  available_deployments: Array<{
    name: string;
    namespace: string;
    image: string;
    detected_language: string;
    replicas: number;
    instrumented: boolean;
  }>;
}

export interface InstrumentRequest {
  deployments: Array<{ name: string; namespace: string }>;
}

export async function enableTracing(baseUrl: string, clusterId: string): Promise<{ status: string; message: string }> {
  return backendRequest(baseUrl, `/api/v1/clusters/${clusterId}/tracing/enable`, { method: 'POST' });
}

export async function getTracingStatus(baseUrl: string, clusterId: string): Promise<TracingStatus> {
  return backendRequest(baseUrl, `/api/v1/clusters/${clusterId}/tracing/status`);
}

export async function instrumentDeployments(baseUrl: string, clusterId: string, req: InstrumentRequest): Promise<{ instrumented: string[]; restarting: boolean }> {
  return backendRequest(baseUrl, `/api/v1/clusters/${clusterId}/tracing/instrument`, {
    method: 'POST',
    body: JSON.stringify(req),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function disableTracing(baseUrl: string, clusterId: string): Promise<{ status: string }> {
  return backendRequest(baseUrl, `/api/v1/clusters/${clusterId}/tracing/disable`, { method: 'POST' });
}
```

- [ ] **Step 2: Verify build**

```bash
cd kubilitics-frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add kubilitics-frontend/src/services/api/tracing.ts
git commit -m "feat: tracing API client — enable/disable/instrument/status"
```

---

### Task 7: Frontend — TracingSetup Wizard + DeploymentPicker

Create the UI components for the one-click setup flow.

**Files:**
- Create: `kubilitics-frontend/src/components/traces/TracingSetup.tsx`
- Create: `kubilitics-frontend/src/components/traces/DeploymentPicker.tsx`
- Create: `kubilitics-frontend/src/components/traces/TracingStatus.tsx`
- Modify: `kubilitics-frontend/src/components/traces/TraceList.tsx`

- [ ] **Step 1: Create TracingStatus.tsx — agent health badge**

Small component that shows the trace-agent status. Used in the Traces page header.
- Polls `GET /tracing/status` every 30s
- Shows: "Tracing Active" (green) / "Agent Offline" (red) / "Not Configured" (gray)
- Click opens the setup wizard

- [ ] **Step 2: Create TracingSetup.tsx — Enable Tracing wizard**

A dialog/card that shows when tracing is not enabled:
- Header: "Enable Distributed Tracing"
- Description: what gets installed (3 components, ~150MB)
- "Enable Tracing" button — calls `enableTracing()`, shows progress spinner
- On success: transitions to DeploymentPicker
- On error: shows error message with retry button
- Uses `Dialog` from shadcn/ui for modal

States:
1. `idle` — shows the enable button
2. `deploying` — spinner with status messages ("Creating namespace...", "Installing cert-manager...", "Deploying trace agent...", "Configuring auto-instrumentation...")
3. `pick_deployments` — shows DeploymentPicker
4. `done` — success message, close dialog
5. `error` — error with retry

- [ ] **Step 3: Create DeploymentPicker.tsx — select deployments to instrument**

Shows a list of deployments from `tracingStatus.available_deployments`:
- Checkbox per deployment
- Shows: name, namespace, detected language badge, replica count
- Pre-selects deployments that are NOT infrastructure (exclude kube-system, kubilitics-system, cert-manager, etc.)
- "Apply Instrumentation" button — calls `instrumentDeployments()`
- Warning: "Selected deployments will be restarted"
- On success: shows "Traces will appear within 60 seconds"

- [ ] **Step 4: Modify TraceList.tsx — integrate setup flow**

Replace the current `OTelSetupGuide` component:
- If `tracingStatus.enabled === false` → show `TracingSetup` (enable button)
- If `tracingStatus.enabled === true && traces.length === 0` → show "Waiting for traces..." with agent status
- If `tracingStatus.enabled === true && traces.length > 0` → show traces table (existing)

Also add `TracingStatus` badge next to the page header.

- [ ] **Step 5: Verify build**

```bash
cd kubilitics-frontend && npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add kubilitics-frontend/src/components/traces/TracingSetup.tsx kubilitics-frontend/src/components/traces/DeploymentPicker.tsx kubilitics-frontend/src/components/traces/TracingStatus.tsx kubilitics-frontend/src/components/traces/TraceList.tsx
git commit -m "feat: tracing setup UI — enable wizard + deployment picker + status badge"
```

---

### Task 8: Integration — Wire Everything + E2E Test

Connect all pieces and validate the full flow.

**Files:**
- Modify: `kubilitics-frontend/src/pages/TracesPage.tsx`
- Modify: `kubilitics-backend/cmd/server/main.go` (final wiring)

- [ ] **Step 1: Update TracesPage.tsx to show TracingStatus in header**

Add `TracingStatus` component next to the Sync button in the page header area. Add a "Disable Tracing" option in a dropdown menu.

- [ ] **Step 2: Full backend build + sidecar rebuild**

```bash
cd kubilitics-backend && go build ./cmd/server/
go build -o ../kubilitics-desktop/src-tauri/binaries/kubilitics-backend-aarch64-apple-darwin ./cmd/server/
```

- [ ] **Step 3: Full frontend build**

```bash
cd kubilitics-frontend && npx tsc --noEmit && npm run build
```

- [ ] **Step 4: E2E test flow**

1. Open Traces page → should show "Enable Distributed Tracing" setup card
2. Click "Enable Tracing" → watch deployment progress
3. Verify in cluster: `kubectl get pods -n kubilitics-system` → trace-agent running
4. Select deployments to instrument → click Apply
5. Verify: `kubectl get deployment <name> -o jsonpath='{.spec.template.metadata.annotations}'` → OTel annotation present
6. Wait 60s → check Traces page for real traces
7. Test "Disable Tracing" → verify cleanup

- [ ] **Step 5: Build trace-agent Docker image**

```bash
cd kubilitics-trace-agent
docker build -t ghcr.io/kubilitics/trace-agent:v0.2.0 .
docker push ghcr.io/kubilitics/trace-agent:v0.2.0
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: distributed tracing — full integration + E2E validated"
```

---

## Self-Review Checklist

| Spec Requirement | Task |
|------------------|------|
| Trace agent (OTel Collector + SQLite + Query API) | Task 1 + 2 |
| K8s manifests (Deployment + Service) | Task 3 |
| Puller (polls agent via K8s service proxy) | Task 4 |
| Enable/disable/instrument/status endpoints | Task 5 |
| Frontend API client | Task 6 |
| Setup wizard + deployment picker + status badge | Task 7 |
| E2E integration + Docker image | Task 8 |
| cert-manager + OTel Operator installation | Task 5 (enable handler) |
| Instrumentation CRs | Task 3 (manifests) |
| Language detection | Task 5 (detectLanguage helper) |
| Disable/cleanup flow | Task 5 (disable handler) + Task 7 (UI) |
| Error handling (all scenarios) | Task 5 (handlers) + Task 7 (UI states) |
| Works on any cluster | Task 4 (K8s service proxy pattern) |
