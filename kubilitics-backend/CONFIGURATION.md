# Kubilitics Backend Configuration

Complete reference for all configuration options, environment variables, and defaults.

## Configuration Sources

Configuration is loaded from (in order of precedence):
1. Environment variables (highest precedence)
2. Configuration file (`config.yaml`) in:
   - `/etc/kubilitics/`
   - `$HOME/.kubilitics/`
   - Current directory (`.`)
3. Default values (lowest precedence)

## Environment Variables

All configuration options can be set via environment variables using the `KUBILITICS_` prefix. For example:
- `KUBILITICS_PORT=8190`
- `KUBILITICS_DATABASE_PATH=/var/lib/kubilitics/kubilitics.db`
- `KUBILITICS_AUTH_MODE=required`

## Configuration Fields

### Server Configuration

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `port` | `int` | `8190` | `KUBILITICS_PORT` | HTTP/HTTPS server port |
| `database_path` | `string` | `./kubilitics.db` | `KUBILITICS_DATABASE_PATH` | SQLite database file path |
| `log_level` | `string` | `info` | `KUBILITICS_LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` |
| `log_format` | `string` | `json` | `KUBILITICS_LOG_FORMAT` | Log format: `json` or `text` |
| `allowed_origins` | `[]string` | `["http://localhost:5173", "http://localhost:8190"]` | `KUBILITICS_ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) |
| `request_timeout_sec` | `int` | `30` | `KUBILITICS_REQUEST_TIMEOUT_SEC` | HTTP read/write timeout (seconds); 0 = server default |
| `shutdown_timeout_sec` | `int` | `15` | `KUBILITICS_SHUTDOWN_TIMEOUT_SEC` | Graceful shutdown wait time (seconds) |

### Kubernetes Configuration

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `kubeconfig_path` | `string` | `""` | `KUBILITICS_KUBECONFIG_PATH` | Path to kubeconfig file (empty = use default `~/.kube/config`) |
| `kubeconfig_auto_load` | `bool` | `true` | `KUBILITICS_KUBECONFIG_AUTO_LOAD` | Auto-load all contexts from default kubeconfig on startup if DB is empty |
| `max_clusters` | `int` | `100` | `KUBILITICS_MAX_CLUSTERS` | Maximum number of registered clusters (0 = no limit) |
| `k8s_timeout_sec` | `int` | `30` | `KUBILITICS_K8S_TIMEOUT_SEC` | Timeout for Kubernetes API calls (seconds); 0 = use request context only |
| `k8s_rate_limit_per_sec` | `float64` | `0` | `KUBILITICS_K8S_RATE_LIMIT_PER_SEC` | Token bucket rate limit per cluster (requests/second); 0 = disabled |
| `k8s_rate_limit_burst` | `int` | `0` | `KUBILITICS_K8S_RATE_LIMIT_BURST` | Token bucket burst size per cluster; 0 = no limit |

### Topology Configuration

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `topology_timeout_sec` | `int` | `30` | `KUBILITICS_TOPOLOGY_TIMEOUT_SEC` | Topology build context timeout (seconds) |
| `topology_cache_ttl_sec` | `int` | `30` | `KUBILITICS_TOPOLOGY_CACHE_TTL_SEC` | Topology cache TTL (seconds); 0 = cache disabled |
| `topology_max_nodes` | `int` | `5000` | `KUBILITICS_TOPOLOGY_MAX_NODES` | Maximum nodes per topology response; 0 = no limit |

### Authentication Configuration (BE-AUTH-001)

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `auth_mode` | `string` | `disabled` | `KUBILITICS_AUTH_MODE` | Authentication mode: `disabled` (no auth), `optional` (accept Bearer or anonymous), `required` (require Bearer token) |
| `auth_jwt_secret` | `string` | `""` | `KUBILITICS_AUTH_JWT_SECRET` | JWT signing secret (required if `auth_mode != disabled`) |
| `auth_admin_user` | `string` | `""` | `KUBILITICS_AUTH_ADMIN_USER` | Bootstrap admin username (created on first run if no users exist) |
| `auth_admin_pass` | `string` | `""` | `KUBILITICS_AUTH_ADMIN_PASS` | Bootstrap admin password (plaintext; only used on first run) |

### TLS Configuration (BE-TLS-001)

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `tls_enabled` | `bool` | `false` | `KUBILITICS_TLS_ENABLED` | Enable TLS/HTTPS |
| `tls_cert_path` | `string` | `""` | `KUBILITICS_TLS_CERT_PATH` | Path to TLS certificate file (PEM format) |
| `tls_key_path` | `string` | `""` | `KUBILITICS_TLS_KEY_PATH` | Path to TLS private key file (PEM format) |

### Tracing Configuration (BE-OBS-001)

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `tracing_enabled` | `bool` | `false` | `KUBILITICS_TRACING_ENABLED` | Enable OpenTelemetry distributed tracing |
| `tracing_endpoint` | `string` | `""` | `KUBILITICS_TRACING_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4317` for gRPC or `http://localhost:4318` for HTTP) |
| `tracing_service_name` | `string` | `kubilitics-backend` | `KUBILITICS_TRACING_SERVICE_NAME` | Service name for traces |
| `tracing_sampling_rate` | `float64` | `1.0` | `KUBILITICS_TRACING_SAMPLING_RATE` | Sampling rate (0.0-1.0); 1.0 = sample all traces |

### KCLI Configuration

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `kcli_rate_limit_per_sec` | `float64` | `12.0` | `KUBILITICS_KCLI_RATE_LIMIT_PER_SEC` | Token bucket rate limit for `/kcli` APIs (requests/second); 0 = disabled |
| `kcli_rate_limit_burst` | `int` | `24` | `KUBILITICS_KCLI_RATE_LIMIT_BURST` | Token bucket burst size for `/kcli` APIs |
| `kcli_stream_max_conns` | `int` | `4` | `KUBILITICS_KCLI_STREAM_MAX_CONNS` | Maximum concurrent `/kcli/stream` sessions per cluster |
| `kcli_allow_shell_mode` | `bool` | `true` | `KUBILITICS_KCLI_ALLOW_SHELL_MODE` | Allow `/kcli/stream?mode=shell` (interactive shell) |

### Data Validation Configuration

| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `apply_max_yaml_bytes` | `int` | `5242880` (5MB) | `KUBILITICS_APPLY_MAX_YAML_BYTES` | Maximum YAML body size for `POST /apply` (bytes); 0 = default 512KB |

## Configuration File Example

Create `config.yaml`:

```yaml
port: 8190
database_path: /var/lib/kubilitics/kubilitics.db
log_level: info
log_format: json
allowed_origins:
  - http://localhost:5173
  - https://kubilitics.example.com

# Kubernetes
kubeconfig_path: ""
kubeconfig_auto_load: true
max_clusters: 100
k8s_timeout_sec: 30
k8s_rate_limit_per_sec: 10.0
k8s_rate_limit_burst: 20

# Topology
topology_timeout_sec: 30
topology_cache_ttl_sec: 30
topology_max_nodes: 5000

# Authentication
auth_mode: required
auth_jwt_secret: "your-secret-key-here-min-32-chars"
auth_admin_user: admin
auth_admin_pass: "change-me-on-first-run"

# TLS
tls_enabled: true
tls_cert_path: /etc/tls/tls.crt
tls_key_path: /etc/tls/tls.key

# Tracing
tracing_enabled: true
tracing_endpoint: http://localhost:4318
tracing_service_name: kubilitics-backend
tracing_sampling_rate: 1.0
```

## Environment Variable Example

```bash
export KUBILITICS_PORT=8190
export KUBILITICS_DATABASE_PATH=/var/lib/kubilitics/kubilitics.db
export KUBILITICS_LOG_LEVEL=info
export KUBILITICS_LOG_FORMAT=json
export KUBILITICS_ALLOWED_ORIGINS="http://localhost:5173,https://kubilitics.example.com"
export KUBILITICS_AUTH_MODE=required
export KUBILITICS_AUTH_JWT_SECRET="your-secret-key-here-min-32-chars"
export KUBILITICS_TLS_ENABLED=true
export KUBILITICS_TLS_CERT_PATH=/etc/tls/tls.crt
export KUBILITICS_TLS_KEY_PATH=/etc/tls/tls.key
```

## Notes

- **Authentication**: When `auth_mode=disabled`, all endpoints are publicly accessible. Use `required` for production.
- **TLS**: For production, use Let's Encrypt certificates via cert-manager or similar. See `README.md` for details.
- **Tracing**: Auto-enabled if `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable is set (standard OpenTelemetry convention).
- **Rate Limiting**: K8s API rate limiting prevents overwhelming cluster API servers. Set based on cluster capacity.
- **Topology Cache**: Cache TTL balances freshness vs performance. Lower TTL = fresher data but more API calls.
- **Ports**: Backend runs on 8190, frontend on 5173.

## Kubeconfig Sync

Kubilitics auto-removes clusters from its SQLite registry when their
kubeconfig context is deleted externally (via `kind delete cluster`,
`kubectl config delete-context`, or editing the file). This keeps the
Fleet page in sync with the user's actual kubeconfig without manual
cleanup.

The feature is modeled on [Headlamp's kubeconfig watcher](https://github.com/headlamp-k8s/headlamp/blob/main/backend/pkg/kubeconfig/watcher.go)
and is hardened with several enterprise safety mechanisms. It is
enabled by default for desktop and browser deployments and
automatically disabled in in-cluster (Helm) mode.

### Configuration

All settings are env-var or yaml-key addressable:

| Env var                                                 | Yaml key                                    | Default | Meaning |
|---------------------------------------------------------|---------------------------------------------|---------|---------|
| `KUBILITICS_KUBECONFIG_SYNC_ENABLED`                    | `kubeconfig_sync_enabled`                   | `true`  | Master kill switch. Set to `false` to disable the watcher entirely. |
| `KUBILITICS_KUBECONFIG_SYNC_HEALTH_INTERVAL_SEC`        | `kubeconfig_sync_health_interval_sec`       | `10`    | Watch-health check cadence. Low cost — re-adds broken fsnotify watches after file renames. |
| `KUBILITICS_KUBECONFIG_SYNC_POLL_INTERVAL_SEC`          | `kubeconfig_sync_poll_interval_sec`         | `60`    | Polling fallback cadence. A full sync runs every N seconds regardless of fsnotify — necessary for NFS, overlayfs, WSL2, and any filesystem where fsnotify doesn't fire events. |
| `KUBILITICS_KUBECONFIG_SYNC_MAX_ABSOLUTE_REMOVALS`      | `kubeconfig_sync_max_absolute_removals`     | `10`    | Safety cap: if a single sync pass would remove >= N clusters, abort with a loud warning + audit entry. |
| `KUBILITICS_KUBECONFIG_SYNC_MAX_REMOVAL_RATIO`          | `kubeconfig_sync_max_removal_ratio`         | `0.5`   | Safety cap: if a single sync pass would remove > N of kubeconfig-sourced clusters (as a ratio), abort. Valid range: (0, 1]. Default 0.5 means "refuse to remove more than half." |
| `KUBILITICS_DEPLOYMENT_MODE`                            | `deployment_mode`                           | auto    | `desktop`, `browser`, or `in-cluster`. Auto-detected from `KUBERNETES_SERVICE_HOST` and `TAURI_ENABLED`. |

### Which clusters are eligible for auto-removal?

Only clusters with `source='kubeconfig'`. Clusters added via the
"upload kubeconfig" flow have `source='upload'` and are never
auto-removed — their source of truth is the Kubilitics-managed file
under `~/.kubilitics/kubeconfigs/`, not the user's system kubeconfig.

### Safety mechanisms

1. **Fail-safe reads.** If a kubeconfig file can't be read or parsed,
   the sync aborts with zero mutations. Transient errors delay
   convergence; they never cause false deletions.

2. **Mass-delete safety cap.** The absolute and ratio thresholds
   above ensure a single errant edit can't wipe a fleet. When the
   cap triggers, an audit entry `cluster_sync_safety_cap_triggered`
   is written with the orphan list, and the user must delete via
   the UI if they really meant it.

3. **Pre-destructive snapshots.** Before any removal pass, Kubilitics
   writes a redacted JSON snapshot of the entire cluster table to
   `~/.kubilitics/snapshots/clusters-pre-sync-<ISO8601>.json`. The
   newest 10 snapshots are retained; older ones are pruned. Snapshots
   contain only metadata — no credentials, no kubeconfig contents.

4. **Audit log.** Every auto-removal produces a `cluster_auto_removed`
   audit entry in the `audit_log` SQLite table with reason, trigger,
   watched paths, and the removed context name. Entries are append-only.

### Recovering a cluster that was removed incorrectly

If a sync pass removed a cluster that shouldn't have been removed,
use the pre-destructive snapshot to restore it:

```bash
# List available snapshots
ls -lt ~/.kubilitics/snapshots/

# Restore from the snapshot taken just before the bad sync
kubilitics-backend restore-snapshot \
    ~/.kubilitics/snapshots/clusters-pre-sync-2026-04-14T10-30-00Z.json
```

Restore is strictly additive: clusters already present in the DB
(matched by ID) are skipped, never overwritten. Re-running restore
on the same snapshot is idempotent.

### How sync gets triggered

The watcher combines three trigger sources, all coalesced through
a single singleflight group so concurrent triggers run the sync
exactly once:

- **`fsnotify_event`**: inotify/FSEvents/ReadDirectoryChangesW
  fires on `Create | Write | Remove | Rename` of any watched file.
  Near-instant — typically < 50ms after the file change.
- **`health_ticker`**: every `KUBILITICS_KUBECONFIG_SYNC_HEALTH_INTERVAL_SEC`
  seconds, the watcher verifies its fsnotify watch list is still
  intact. If a watch broke (common after atomic file replace),
  the watcher re-adds the path AND runs a sync to catch up.
- **`poll_fallback`**: every `KUBILITICS_KUBECONFIG_SYNC_POLL_INTERVAL_SEC`
  seconds, the watcher runs a full sync regardless of fsnotify
  activity. This is the safety net for filesystems where fsnotify
  doesn't fire events (NFS, overlayfs, WSL2 cross-boundary mounts).
- **`startup`**: the watcher runs a one-shot sync immediately when
  Kubilitics starts, so the registry converges on any changes made
  while the backend was offline.

### Disabling the feature

Set `KUBILITICS_KUBECONFIG_SYNC_ENABLED=false` and restart the
backend. The watcher will not start; no clusters will be auto-removed.
The feature can be re-enabled later without any state rollback —
the SQLite registry is preserved regardless.
