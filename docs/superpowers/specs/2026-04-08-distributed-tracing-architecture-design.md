# Distributed Tracing Architecture — Design Spec

**Goal:** One-click distributed tracing for Kubilitics. User clicks "Enable Tracing" on the Traces page, Kubilitics deploys an in-cluster trace agent + OTel auto-instrumentation, user picks which deployments to instrument, real traces flow into the UI.

**Architecture:** Pull-based (consistent with metrics, logs, events). A lightweight agent pod runs inside the cluster. Kubilitics desktop pulls traces from it via K8s service proxy.

**Tech Stack:** Go (trace agent), OTel Collector (embedded), SQLite (trace storage), Helm (OTel Operator + cert-manager), K8s mutating webhooks (auto-instrumentation).

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    USER'S CLUSTER                     │
│                                                        │
│  App Pods ──(OTel auto-injected)──► OTLP :4317/4318  │
│                                          │             │
│                                          ▼             │
│  ┌──────────────────────────────────────────┐         │
│  │  kubilitics-trace-agent                   │         │
│  │  Namespace: kubilitics-system              │         │
│  │                                           │         │
│  │  ┌─────────────┐  ┌──────────────────┐   │         │
│  │  │ OTel Collector│  │ SQLite (24h)     │   │         │
│  │  │ Receiver      │──│ spans + traces   │   │         │
│  │  └─────────────┘  └──────────────────┘   │         │
│  │                    ┌──────────────────┐   │         │
│  │                    │ Query API :9417   │   │         │
│  │                    │ GET /traces       │   │         │
│  │                    │ GET /traces/{id}  │   │         │
│  │                    │ GET /services     │   │         │
│  │                    └──────────────────┘   │         │
│  └──────────────────────────────────────────┘         │
│         ▲                                              │
│  ┌──────┴──────────────┐  ┌────────────────────────┐  │
│  │  cert-manager       │  │  opentelemetry-operator │  │
│  │  (if not present)   │  │  + Instrumentation CRs  │  │
│  └─────────────────────┘  └────────────────────────┘  │
└────────────────────┬─────────────────────────────────┘
                     │ K8s service proxy (via kubeconfig)
                     │
┌────────────────────┼─────────────────────────────────┐
│  KUBILITICS DESKTOP                                    │
│                    │                                    │
│  Go Backend ───────┘                                   │
│    │  Polls trace-agent every 15s                      │
│    │  Stores in local SQLite (existing otel/store.go)  │
│    ▼                                                    │
│  React Frontend                                        │
│    Traces page, Service Map, Span Waterfall             │
└────────────────────────────────────────────────────────┘
```

## 2. Components

### 2.1 kubilitics-trace-agent (new — custom Docker image)

A single Go binary that embeds:
- **OTel Collector receiver** — listens on :4317 (gRPC) and :4318 (HTTP) for OTLP traces
- **SQLite storage** — stores spans and trace summaries with 24h rolling retention
- **REST query API** on :9417 — serves trace data to Kubilitics desktop

The agent reuses the existing `internal/otel/store.go` and `internal/otel/receiver.go` code from the Kubilitics backend. It's essentially a stripped-down Kubilitics backend that only handles traces.

**Deployment spec:**
- Deployment with 1 replica
- Namespace: `kubilitics-system` (created if not exists)
- Resources: 64Mi memory request, 128Mi limit. 50m CPU request, 200m limit.
- Storage: emptyDir volume for SQLite (no PVC needed — 24h retention keeps it small)
- Service: ClusterIP exposing ports 4317, 4318, 9417
- No RBAC needed (agent doesn't access K8s API — it only receives OTLP and serves queries)

**Query API endpoints:**

```
GET /traces?limit=100&from=<unix_ns>&to=<unix_ns>&service=<name>&status=<OK|ERROR>
  → [{trace_id, root_service, root_operation, duration_ns, span_count, error_count, status, start_time}]

GET /traces/{traceId}
  → {trace_id, spans: [{span_id, parent_span_id, service_name, operation_name, ...}]}

GET /services?from=<unix_ns>&to=<unix_ns>
  → {nodes: [{name, span_count, error_count, avg_duration_ns}], edges: [{source, target, count}]}

GET /health
  → {status: "ok", span_count: 12345, oldest_span: <unix_ns>}
```

**Docker image:** Published to GitHub Container Registry as `ghcr.io/kubilitics/trace-agent:<version>`.

### 2.2 Kubilitics Backend — Trace Puller (modify existing)

New service in `internal/otel/puller.go` that:
- Discovers the trace-agent in the cluster via K8s service proxy: `GET /api/v1/namespaces/kubilitics-system/services/kubilitics-trace-agent:9417/proxy/traces`
- Polls every 15 seconds for new traces (since last poll timestamp)
- Stores pulled traces in the existing local SQLite (same `otel/store.go`)
- The existing frontend hooks (`useTraces`, `useServiceMap`) work unchanged — they query the local backend which now has real data

**Why pull instead of direct proxy?**
- Offline access: traces are cached locally even if cluster disconnects
- Faster UI: local SQLite queries are <1ms vs network round-trip
- Consistent with metrics/events pattern

### 2.3 One-Click Setup Flow (frontend + backend)

**Frontend: Traces page "Enable Tracing" button**

When no trace-agent is detected in the cluster:

```
┌─────────────────────────────────────────────────┐
│                                                   │
│        ⟁  Enable Distributed Tracing             │
│                                                   │
│  Kubilitics will deploy a lightweight trace       │
│  agent into your cluster to collect OpenTelemetry │
│  traces from your applications.                   │
│                                                   │
│  What gets installed:                             │
│  • Trace Agent (receives + stores traces)         │
│  • OTel Operator (auto-instruments your apps)     │
│  • cert-manager (required by OTel Operator)       │
│                                                   │
│  Total footprint: ~3 small pods, ~150MB memory    │
│                                                   │
│  [ Enable Tracing ]                               │
│                                                   │
└─────────────────────────────────────────────────┘
```

**Backend: `POST /api/v1/clusters/{id}/tracing/enable`**

Orchestrates the deployment in order:
1. Create namespace `kubilitics-system` (if not exists)
2. Check if cert-manager is installed (look for cert-manager namespace or CRDs). If not, install via Helm.
3. Install OTel Operator via Helm
4. Deploy kubilitics-trace-agent (Deployment + Service manifest via `/apply`)
5. Create Instrumentation CRs (one per language: Java, Node.js, Python, Go, .NET) pointing to `kubilitics-trace-agent.kubilitics-system:4317`
6. Return success + list of deployments available for instrumentation

**Backend: `GET /api/v1/clusters/{id}/tracing/status`**

Returns current tracing setup state:
```json
{
  "enabled": true,
  "agent_healthy": true,
  "agent_span_count": 12345,
  "cert_manager_installed": true,
  "otel_operator_installed": true,
  "instrumented_deployments": ["auth-service", "payment-api"],
  "available_deployments": ["cart-service", "inventory-api", "..."]
}
```

### 2.4 Deployment Picker (frontend)

After setup completes, show a deployment picker:

```
┌─────────────────────────────────────────────────┐
│  Select deployments to instrument                │
│                                                   │
│  Kubilitics will inject OpenTelemetry into these  │
│  deployments. They will be restarted.             │
│                                                   │
│  ☑ auth-service          (kubilitics-demo)       │
│  ☑ payment-processor     (payments-prod)         │
│  ☑ order-service         (ecommerce-prod)        │
│  ☐ redis-cluster         (kubilitics-demo)       │
│  ☐ mongo                 (ecommerce-prod)        │
│                                                   │
│  Detected languages: Java (3), Node.js (2)       │
│                                                   │
│  [ Apply Instrumentation ]                        │
│                                                   │
└─────────────────────────────────────────────────┘
```

**Backend: `POST /api/v1/clusters/{id}/tracing/instrument`**

```json
{
  "deployments": [
    {"name": "auth-service", "namespace": "kubilitics-demo"},
    {"name": "payment-processor", "namespace": "payments-prod"}
  ]
}
```

For each deployment:
1. Detect language from container image (java/node/python/go/dotnet)
2. Add annotation: `instrumentation.opentelemetry.io/inject-<lang>: "kubilitics-auto"`
3. Trigger rolling restart: `kubectl rollout restart deployment/<name> -n <namespace>`

### 2.5 Disable/Cleanup

**Backend: `POST /api/v1/clusters/{id}/tracing/disable`**

1. Remove Instrumentation annotations from all annotated deployments
2. Trigger rolling restart (removes injected sidecars)
3. Delete kubilitics-trace-agent Deployment + Service
4. Optionally delete OTel Operator + cert-manager (user choice — they might use them for other things)

## 3. Data Flow

```
1. User clicks "Enable Tracing"
2. Backend deploys: cert-manager → OTel Operator → trace-agent → Instrumentation CRs
3. User selects deployments to instrument
4. Backend annotates deployments + rolling restart
5. OTel Operator injects SDK into pods (mutating webhook)
6. Pods send traces → trace-agent (in-cluster, :4317)
7. Trace-agent stores in SQLite (24h rolling)
8. Kubilitics backend polls trace-agent every 15s via K8s service proxy
9. Traces appear in frontend (list, waterfall, service map)
```

## 4. Error Handling

| Scenario | Handling |
|----------|----------|
| cert-manager already installed | Skip step, continue |
| OTel Operator already installed | Skip step, continue |
| Namespace already exists | Skip creation, continue |
| Agent deploy fails | Return error with K8s event details, show in UI |
| Agent unreachable (pod crashed) | Puller retries every 15s, UI shows "Agent offline" badge |
| Cluster disconnects | Local cache serves existing traces, puller pauses |
| Language detection fails | Default to Java instrumentation (most common), let user override |
| Instrumented pod crashes | OTel injection is non-blocking — app starts without tracing if SDK fails |

## 5. File Structure

```
kubilitics-backend/
  internal/otel/
    puller.go              (NEW — polls trace-agent for new traces)
    trace_agent_deploy.go  (NEW — deploy/undeploy agent manifests)
  internal/api/rest/
    tracing.go             (NEW — /tracing/enable, /status, /instrument, /disable endpoints)

kubilitics-trace-agent/    (NEW — separate Go binary)
  cmd/agent/main.go        (entry point — starts collector + query API)
  internal/
    collector.go           (OTel Collector receiver config)
    store.go               (reuse from kubilitics-backend/internal/otel/store.go)
    api.go                 (REST query API on :9417)
  Dockerfile               (multi-stage build, ~50MB final image)

kubilitics-frontend/
  src/components/traces/
    TracingSetup.tsx        (NEW — Enable Tracing wizard)
    DeploymentPicker.tsx    (NEW — select deployments to instrument)
    TracingStatus.tsx       (NEW — status badge showing agent health)
```

## 6. What This Does NOT Include

- **Log correlation** — linking traces to pod logs (future enhancement)
- **Metrics correlation** — linking traces to pod CPU/memory (future enhancement)
- **Custom OTel Collector config** — users can't customize pipelines (keep it simple)
- **Multi-tenant** — single trace-agent per cluster (no per-namespace isolation)
- **Long-term trace storage** — 24h rolling window only (not a Datadog replacement for retention)

## 7. Success Criteria

1. User clicks one button on Traces page → 3 components deploy in <2 minutes
2. User picks deployments → traces appear within 60 seconds of pod restart
3. Works on Docker Desktop, kind, minikube, EKS, AKS, GKE without configuration
4. Trace page shows real request flows with service names, durations, errors
5. Service map populates from real trace data
6. "Disable Tracing" cleanly removes everything
