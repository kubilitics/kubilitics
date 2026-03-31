# kcli — The Kubernetes CLI That Thinks

> **Note:** kcli is an external CLI tool available at [github.com/vellankikoti/kcli](https://github.com/vellankikoti/kcli). The features described below represent the kcli roadmap; see the kcli repository for current capabilities.

## What kcli Is

`kcli` is a drop-in replacement for `kubectl` with three major additions:

1. **Ergonomics** — fluid context/namespace switching, sensible defaults, readable output
2. **Observability** — built-in health, metrics, events, restarts, and incident commands that would otherwise require multiple `kubectl` invocations and manual parsing
3. **AI** — optional AI-powered log analysis, root cause investigation, and automated fix proposals (bring your own API key)

Plus a full-screen terminal UI, a plugin marketplace, and a safety model that makes destructive commands opt-in rather than default.

---

## Installation

```bash
# macOS (Homebrew)
brew install kubilitics/tap/kcli

# Linux (curl install)
curl -sSL https://get.kubilitics.io/kcli | sh

# Go install
go install github.com/kubilitics/kubilitics/kcli/cmd/kcli@latest

# Verify
kcli version
```

After installation, kcli works with your existing `~/.kube/config`. No additional setup required.

---

## Core Commands

### Context and Namespace

The most common kubectl pain point is switching context and namespace. kcli makes this a one-liner:

```bash
kcli ctx                    # List all contexts with current highlighted
kcli ctx production         # Switch to production context
kcli ctx -                  # Switch back to previous context
kcli ctx --current          # Print current context name

kcli ns                     # List all namespaces
kcli ns kube-system         # Switch to kube-system namespace
kcli ns -                   # Switch back to previous namespace
kcli ns --current           # Print current namespace
```

All context and namespace preferences are remembered per-session and restored on next launch.

### kubectl Parity

Every `kubectl` command works through kcli as a passthrough:

```bash
kcli get pods -A
kcli get pods -n production -l app=api-server
kcli describe pod api-server-7d8b9c-xyz -n production
kcli apply -f manifest.yaml
kcli apply -k ./overlays/production
kcli delete pod api-server-7d8b9c-xyz -n production
kcli logs api-server-7d8b9c-xyz -f --tail=100
kcli exec -it api-server-7d8b9c-xyz -- /bin/sh
kcli port-forward svc/api-server 8080:80 -n production
kcli cp production/api-server-7d8b9c-xyz:/app/config ./config
kcli rollout status deployment/api-server -n production
kcli rollout history deployment/api-server -n production
kcli scale deployment/api-server --replicas=5 -n production
```

### Safety Model

Mutating commands (`apply`, `delete`, `scale`, `exec`, `patch`) prompt for confirmation by default:

```
$ kcli delete pod api-server-7d8b9c-xyz -n production

⚠ This will delete pod/api-server-7d8b9c-xyz in namespace production.
  This pod is part of deployment/api-server (3 replicas).
  A replacement pod will be scheduled automatically.

Confirm? [y/N]:
```

For CI/automation, bypass with `--force`:

```bash
kcli delete pod api-server-7d8b9c-xyz -n production --force
```

---

## Observability Commands

These are the commands that make kcli uniquely valuable for on-call engineers. They aggregate information that would otherwise require multiple `kubectl` commands and manual log parsing.

### Cluster Health

```bash
kcli health                     # Full cluster health summary
kcli health pods                # Pod health: ready vs not-ready, crash loops
kcli health nodes               # Node health: capacity, conditions, taints
kcli health -n production       # Namespace-scoped health report
```

Example output:
```
Cluster: production-eks | 3/3 nodes healthy

Pods: 47/50 running
  ✗ payment-service-xyz    CrashLoopBackOff   (14 restarts, last: 2m ago)
  ✗ redis-cache-abc        Pending            (no nodes match affinity)
  ⚠ worker-def             Running            (high memory: 94%)

Nodes:
  ✓ ip-10-0-1-11   Ready   CPU: 34%   Mem: 67%
  ✓ ip-10-0-1-12   Ready   CPU: 41%   Mem: 72%
  ⚠ ip-10-0-1-13   Ready   CPU: 78%   Mem: 91%  (resource pressure)
```

### Restarts and Instability

```bash
kcli restarts                   # All pods with restart counts
kcli restarts --recent=1h       # Only pods with restarts in last hour
kcli restarts --threshold=5     # Only pods with > 5 restarts
kcli instability                # Identify unstable resources (flapping)
```

### Events

```bash
kcli events                     # Recent events across all namespaces
kcli events -n production       # Namespace-scoped events
kcli events --recent=30m        # Events in last 30 minutes
kcli events --type=Warning      # Warning events only
kcli events --watch             # Live event stream
kcli events --reason=BackOff    # Filter by event reason
```

### Metrics

```bash
kcli metrics                    # Cluster-wide resource utilisation
kcli metrics pods               # Per-pod CPU/memory
kcli metrics nodes              # Per-node CPU/memory
kcli metrics -n production      # Namespace-scoped metrics
kcli metrics pods --sort=cpu    # Sort by CPU usage
kcli metrics pods --sort=mem    # Sort by memory usage
```

### Incident Commands

For active incidents, these commands give you everything in one shot:

```bash
kcli incident logs production/api-server     # All logs from all pods in deployment
kcli incident logs production/api-server --tail=200 --since=1h
kcli incident describe production/api-server # Full incident profile: pods, events, errors
kcli incident restart production/api-server  # Rolling restart with confirmation
```

---

## AI Commands

AI features require an API key. Set one env var and every AI command becomes available:

```bash
# Choose your provider
export KCLI_AI_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Or use OpenAI
export KCLI_AI_PROVIDER=openai
export OPENAI_API_KEY=sk-...

# Or use Ollama (local, no API key)
export KCLI_AI_PROVIDER=ollama
# (Ollama must be running locally)
```

### Log Analysis

```bash
kcli logs payment-service-xyz --ai-summarize
# → "The pod is failing due to database connection timeouts. The connection pool
#    is exhausted (100/100 connections). Recommend increasing DB_MAX_CONNECTIONS
#    from 10 to 30 or scaling the deployment to reduce per-pod load."

kcli logs payment-service-xyz --ai-errors
# → Lists and groups all unique error patterns with occurrence counts

kcli logs payment-service-xyz --ai-explain
# → Explains what each log line means in plain English
```

### Root Cause Investigation

```bash
kcli why pod/payment-service-xyz -n production
# → Full AI investigation: why is this pod failing?
#    Evidence chain, root cause hypothesis, recommended fix

kcli why deployment/api-server -n production
# → Why are pods in this deployment unhealthy?

kcli summarize events -n production
# → Plain-English summary of all recent warning events and their significance
```

### Fix Suggestions

```bash
kcli suggest fix deployment/api-server -n production
# → Proposes specific remediation steps with kubectl commands to execute

kcli fix deployment/api-server -n production
# → Proposes fix AND offers to apply it (with confirmation)
```

### Freeform AI Query

```bash
kcli ai "which pods have been restarting most frequently in the last hour?"
kcli ai "is there any sign of a memory leak in the worker namespace?"
kcli ai "what would happen if I deleted the api-server service?"
kcli ai "why is my HPA not scaling?"
```

### AI Configuration

```bash
kcli ai config --provider=anthropic --model=claude-3-5-sonnet-20241022 --enable
kcli ai config --provider=ollama --model=llama3 --enable
kcli ai status          # Current AI config and connection status
kcli ai usage           # Token usage this month
kcli ai cost            # Estimated cost this month
```

---

## Terminal UI (TUI)

```bash
kcli ui
```

The TUI is a full-screen dashboard with:

**Pod Table View**
- All pods across all namespaces, live-updating
- Colour-coded by status (green/yellow/red)
- Sort by namespace, name, status, restarts, age, CPU, memory
- Filter with `/` (fuzzy search)

**Pod Detail View**
Navigate into any pod with `Enter`:
- Tab 1: Overview (status, conditions, volumes, environment)
- Tab 2: Events (all events for this pod)
- Tab 3: YAML (full resource spec)

**Controls**
```
/         Start filtering (fuzzy search)
j/k       Move selection up/down
Enter     Open detail view
1/2/3     Switch tabs in detail view
Esc       Back to table
q         Quit
r         Force refresh
n         Switch namespace
c         Switch context
```

---

## Plugin System

kcli has a first-class plugin marketplace for extending its capabilities.

### Plugin Commands

```bash
kcli plugin list                            # Show installed plugins
kcli plugin search istio                    # Search marketplace
kcli plugin marketplace                     # Browse all available plugins
kcli plugin info kubilitics/istio           # Full plugin details
kcli plugin install kubilitics/istio        # Install from marketplace
kcli plugin install ./my-plugin             # Install from local directory
kcli plugin install github.com/user/plugin  # Install from GitHub
kcli plugin update istio                    # Update specific plugin
kcli plugin update --all                    # Update all plugins
kcli plugin uninstall istio                 # Remove plugin
```

### Official Plugins

| Plugin | Description |
|--------|-------------|
| `istio` | Istio service mesh management: VirtualServices, DestinationRules, traffic management, mTLS status |
| `argocd` | ArgoCD integration: app sync status, rollback, diff, history |
| `cert-manager` | Certificate management: cert status, renewal, issuer health |
| `flux` | FluxCD integration: reconciliation status, source sync |
| `velero` | Backup management: backup status, restore, schedule |

### Building a Plugin

A kcli plugin is any executable named `kcli-<name>` in `$PATH`. When you run `kcli mycommand`, kcli looks for `kcli-mycommand` and executes it, passing all arguments through.

For richer integration (tab completion, metadata, permissions), plugins include a manifest:

```yaml
# ~/.kcli/plugins/my-plugin/manifest.yaml
name: my-plugin
version: 1.0.0
description: "My custom kcli plugin"
author: "Your Name"
permissions:
  allow:
    - "get pods"
    - "get deployments"
  deny:
    - "delete *"
```

---

## Configuration

kcli persists configuration to `~/.kcli/config.yaml`.

```bash
kcli config view                            # Print current config
kcli config get tui.refresh_interval        # Get a specific value
kcli config set tui.refresh_interval 3s    # Set a value
kcli config set ai.provider anthropic       # Set AI provider
kcli config set ai.model claude-3-5-sonnet-20241022
kcli config set safety.require_confirm true # Require confirmation for mutations
kcli config reset --yes                     # Reset to defaults
kcli config edit                            # Open config in $EDITOR
```

### Key Configuration Options

```yaml
# ~/.kcli/config.yaml

tui:
  refresh_interval: 5s        # Live update interval in TUI
  default_namespace: default   # Default namespace on startup
  show_all_namespaces: false   # Show all namespaces by default

ai:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
  enabled: true
  max_tokens: 2048

safety:
  require_confirm: true        # Prompt before mutating operations
  confirm_deletes: true        # Extra confirmation for deletes
  confirm_scale_to_zero: true  # Extra confirmation when scaling to 0

output:
  format: table                # table | json | yaml | wide
  color: true
  timestamps: relative         # relative | absolute | none
```

---

## Architecture

```
kcli/
├── cmd/kcli/
│   └── main.go              # Entry point: plugin dispatch → cobra → kubectl passthrough
│
├── internal/cli/
│   ├── root.go              # Root command + global flags
│   ├── context.go           # ctx commands
│   ├── namespace.go         # ns commands
│   ├── health.go            # health commands
│   ├── events.go            # events commands
│   ├── metrics.go           # metrics commands
│   ├── restarts.go          # restarts + instability commands
│   ├── incident.go          # incident commands
│   ├── ai.go                # ai + why + fix commands
│   └── plugin.go            # plugin marketplace commands
│
├── internal/runner/
│   ├── runner.go            # Command classification (mutating vs read-only)
│   └── confirm.go           # Interactive confirmation with blast-radius info
│
├── internal/k8sclient/
│   ├── client.go            # kubeconfig parsing + clientset init
│   ├── cache.go             # Short-TTL in-process resource cache
│   └── context.go           # Context and namespace management
│
├── internal/ui/
│   ├── model.go             # Bubble Tea app model
│   ├── pods.go              # Pod table component
│   ├── detail.go            # Pod detail view
│   └── keys.go              # Keybindings
│
└── internal/plugin/
    ├── discovery.go         # Find plugins in ~/.kcli/plugins/ and $PATH
    ├── manifest.go          # Manifest parsing and validation
    └── permissions.go       # Permission allow/deny enforcement
```

---

## Comparison to kubectl

| Capability | kubectl | kcli |
|-----------|---------|------|
| All resource CRUD | ✅ | ✅ (passthrough) |
| Context switching | Multi-step | `kcli ctx <name>` |
| Namespace switching | `--namespace` flag | `kcli ns <name>` |
| Pod health overview | Manual parsing | `kcli health pods` |
| Recent restarts | Multiple commands | `kcli restarts --recent=1h` |
| Events with filtering | Limited | `kcli events --type=Warning` |
| Incident log aggregation | One pod at a time | `kcli incident logs ns/deployment` |
| AI log analysis | None | `kcli logs pod --ai-summarize` |
| Root cause investigation | None | `kcli why pod/name` |
| Auto-fix suggestions | None | `kcli suggest fix` |
| Full-screen TUI | None | `kcli ui` |
| Plugin marketplace | None | `kcli plugin marketplace` |
| Mutation confirmation | Never | Always (configurable) |
| Completion caching | Basic | Short-TTL cache (faster) |
