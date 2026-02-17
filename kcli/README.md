# kcli

`kcli` is the Kubilitics terminal core: kubectl-parity workflows with guardrails, context ergonomics, observability shortcuts, incident mode, and optional AI.

## Build

```bash
cd kcli
go build -o bin/kcli ./cmd/kcli
```

## Shell completion

```bash
kcli completion bash > /etc/bash_completion.d/kcli
kcli completion zsh > "${fpath[1]}/_kcli"
```

## Example usage

```bash
kcli get pods -A
kcli get pods -A --all-contexts
kcli get deploy -A --all-contexts --context-group prod
kcli search payments
kcli search api --context-group prod --kinds deployments,services,ingresses
kcli ctx
kcli ctx prod-cluster
kcli ctx group set prod prod-us-east prod-us-west
kcli ctx group prod
kcli ctx group export groups.json
kcli ctx group import groups.json --merge
kcli ns kube-system
kcli restarts
kcli events --recent 30m --output json
kcli incident
kcli incident --recent 2h --restarts-threshold 5 --output json
kcli config view
kcli config set tui.refresh_interval 3s
kcli config get tui.refresh_interval
kcli exec -it pod/my-pod -- /bin/sh
kcli logs app=demo-app -n blue-green-demo --tail=50 --grep='error' --save=logs.txt
kcli logs deployment/my-app -n prod -f --timestamps
kcli logs pod/my-pod --ai-summarize
kcli logs app=my-api -n prod --ai-errors
kcli logs pod/my-pod --ai-explain
```

## Safety model

Mutating verbs prompt for confirmation by default. Use `--force` to bypass prompt in automated workflows.

```bash
kcli delete pod my-pod
kcli --force delete pod my-pod
```

## Optional AI

Set `KCLI_AI_PROVIDER` and provider-specific credentials to enable AI commands.

Supported providers:
- `openai`: `KCLI_AI_PROVIDER=openai`, `KCLI_OPENAI_API_KEY` (or `KCLI_AI_API_KEY`), optional `KCLI_AI_MODEL`, optional `KCLI_AI_ENDPOINT`
- `anthropic`: `KCLI_AI_PROVIDER=anthropic`, `KCLI_ANTHROPIC_API_KEY` (or `KCLI_AI_API_KEY`), optional `KCLI_AI_MODEL`
- `azure-openai`: `KCLI_AI_PROVIDER=azure-openai`, `KCLI_AZURE_OPENAI_API_KEY`, `KCLI_AZURE_OPENAI_ENDPOINT`, `KCLI_AZURE_OPENAI_DEPLOYMENT`, optional `KCLI_AZURE_OPENAI_API_VERSION`
- `ollama`: `KCLI_AI_PROVIDER=ollama`, optional `KCLI_OLLAMA_ENDPOINT`, optional `KCLI_AI_MODEL`
- `custom`: `KCLI_AI_PROVIDER=custom`, `KCLI_AI_ENDPOINT`, optional `KCLI_AI_API_KEY`

```bash
export KCLI_AI_PROVIDER=openai
export KCLI_OPENAI_API_KEY=sk-...
kcli ai explain deployment/my-app
kcli why pod/my-pod
kcli summarize events
kcli suggest fix deployment/my-app
kcli ai config --provider=openai --model=gpt-4o-mini --enable
kcli ai status
kcli ai usage
kcli ai cost
```

## Interactive TUI

`kcli ui` launches the built-in Bubble Tea interface.

Keybindings:
- `/` filter current resource list
- `:<type>` switch resources (`:pods`, `:deploy`, `:svc`, `:nodes`, `:events`, `:ns`, `:ing`, `:cm`, `:secrets`, `:pvc`, `:jobs`, `:cronjobs`)
- `Ctrl+X` or `:xray` open relationship graph for selected resource
- `Space` multi-select rows
- `Ctrl+B` bulk actions (`delete` or `scale=<n>`, with explicit `yes` confirmation)
- `Ctrl+S` save current table snapshot
- `Ctrl+W` toggle wide mode
- `Ctrl+T` cycle themes
- `Ctrl+A` toggle AI on/off in TUI
- `l` logs
- `d` describe
- `y` yaml
- `A` AI analyze (when enabled)
- In detail mode: `4` opens AI Analysis tab
- `r` refresh
- `q` quit

## Plugins

Plugins live in `~/.kcli/plugins/` and use executable name prefix `kcli-`.
Each plugin must include a manifest (`plugin.yaml`) in the same directory.

```bash
kcli plugin list
kcli plugin search demo
kcli plugin marketplace
kcli plugin install cert-manager
kcli plugin info mytool
kcli plugin install ./my-local-plugin
kcli plugin install github.com/org/kcli-mytool
kcli plugin update mytool
kcli plugin update --all
kcli plugin remove mytool
kcli plugin inspect mytool
kcli plugin allow mytool
kcli plugin revoke mytool
kcli plugin run mytool --flag value
```

Example manifest:

```yaml
name: mytool
version: 1.0.0
description: Example plugin
permissions:
  - read:pods
  - write:deployments
commands:
  - mt
```

You can also run plugins directly as first-class commands:

```bash
kcli mytool --flag value
kcli mt --flag value
```

Plugin sandboxing:
- By default, only plugins under `~/.kcli/plugins/` are executable.
- PATH plugins are blocked unless `KCLI_PLUGIN_ALLOW_PATH=1` is explicitly set.

Official plugins in this repo:

```bash
./scripts/install-official-plugins.sh
./scripts/test-official-plugins.sh
```

## State storage

Context history and favorites are persisted in `~/.kcli/state.json`.
Configuration is stored in `~/.kcli/config.yaml`.

## Performance checks

Run the reproducible performance gate for TASK-KCLI-018:

```bash
cd kcli
./scripts/perf-check.sh
```

This validates P95 startup/get/ctx latency and peak memory targets.

## Alpha readiness checks

Run the alpha smoke suite:

```bash
cd kcli
./scripts/alpha-smoke.sh
```

This exercises core commands, completion generation, cluster checks (when context is present), and performance gates.

## Release gate

Run the enterprise release gate before shipping:

```bash
cd kcli
./scripts/release-gate.sh
```

This executes full tests, alpha smoke checks, and performance gates.
