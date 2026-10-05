# Terminal Feature — Critical Gap Analysis

**Date**: 2026-10-02
**Branch**: `feat/terminal`
**Status**: Investigation complete, pre-design

## Why this exists

The terminal is called out as a lifeline feature of Kubilitics (3am-incident-savior
positioning). Current state does not meet that bar: no reliable way to close a
terminal session, a "k9s integration" that silently no-ops for most users, dead
backend code duplicating the live path, zero test coverage on the PTY/WebSocket
mechanism, and a half-migrated desktop (Tauri) story that the terminal code still
branches on. This document is the evidence base before any design or implementation
work starts.

## Headline finding: there are two unrelated terminal subsystems, never unified

1. **Per-pod/workload exec terminal** — opened from a Pod/Deployment/StatefulSet/etc.
   detail page's "Terminal" tab. Talks to the Kubernetes API's `remotecommand`
   (i.e. `kubectl exec` equivalent, inside a specific pod/container).
2. **Global Cluster Shell Panel** — opened from the header's Terminal icon. Spawns a
   local shell process on the machine running the backend, with `KUBECONFIG` set.

These share no code, no state model, and no visual language beyond "xterm.js in a
box." A user has no way to know these are different things with different
semantics (one is "inside a pod," the other is "on your machine").

---

## Component-by-component verdicts

### 1. Frontend Terminal UI — Partially working (root cause of "no close button" found)

- [`kubilitics-frontend/src/components/resources/PodTerminal.tsx`](../../../kubilitics-frontend/src/components/resources/PodTerminal.tsx) — single
  xterm+WS session, real exec via k8s `remotecommand`. Well engineered in isolation:
  IntersectionObserver-gated connect, ResizeObserver, visibilitychange reconnect,
  12s connect timeout, auto-reconnect on unexpected close (lines 207-220),
  fullscreen with Esc-to-exit.
- [`MultiTerminal.tsx`](../../../kubilitics-frontend/src/components/resources/MultiTerminal.tsx) — tab manager over multiple
  `PodTerminal` instances; keeps all sessions mounted with `display:none` so
  history survives tab switches (intentional, per its own header comment).
- [`WorkloadTerminalTab.tsx`](../../../kubilitics-frontend/src/components/resources/WorkloadTerminalTab.tsx) — wraps `MultiTerminal` for
  workloads that own pods.

**Root cause of "no clear close option"**: `MultiTerminal.tsx:129-135` gates the
per-tab close (X) button behind `sessions.length > 1`. The default, most common
case — a user opens a pod's Terminal tab and has exactly one session — has **no
close/kill control anywhere**. Navigating away leaves the component mounted
off-screen with its WebSocket still open; there is no idle timeout and no visible
"this terminal is still running" indicator. Over a long debugging session this
leaks live PTYs + WS connections server-side with no UI path to clean them up
short of quitting the app.

**Stale PRD mismatch**: `kubilitics-frontend/docs/PRD.md:1587` documents a
`TerminalViewer.tsx` component that does not exist in the repo, and a `⌘⇧T`
"toggle terminal" shortcut (`PRD.md:2122`) that is not implemented anywhere
(`useKeyboardShortcuts.ts` has zero matches). The spec and shipped code have
diverged significantly.

### 2. Global Cluster Shell Panel — Working, shares the same tab-close bug

- [`ClusterShellPanel.tsx`](../../../kubilitics-frontend/src/components/shell/ClusterShellPanel.tsx) — floating bottom panel, multi-tab
  (max 8), drag-resize, maximize, **does** have a real panel-level close button
  (lines 317-323). This part is fine.
- Same per-tab-close gating bug exists at line 228 (`sessions.length > 1 &&`).
- [`ShellSession.tsx`](../../../kubilitics-frontend/src/components/shell/ShellSession.tsx) — exponential-backoff reconnect (max 5
  attempts), periodic shell-state sync (2s interval w/ backoff), tab-completion
  wired to backend. Solid implementation.

### 3. Backend PTY/Exec — Working, but with a major dead-code duplication

Three handlers in `kubilitics-backend/internal/api/rest/`:

- `exec.go` — per-pod/container exec via k8s `remotecommand` (backs `PodTerminal`).
- `shell_stream.go` (`GetShellStream`, `/clusters/{clusterId}/shell/stream`) —
  spawns a local bash/sh with `KUBECONFIG` set; backs the Cluster Shell Panel.
- `kcli_stream.go` (`GetKCLIStream`, `/clusters/{clusterId}/kcli/stream`) — a
  **~95% duplicate** of `shell_stream.go` (same PTY setup, ping/pong, rcfile
  writing, aliasing). Its route is registered (`handler.go:597`) and its frontend
  URL builder `getKCLIShellStreamUrl` (`shell.ts:75-91`) exists, but **nothing in
  the UI ever calls it** — confirmed by repo-wide grep (only appears in its own
  definition, its own test, and re-export barrels). This is a fully-built,
  fully-wired, completely orphaned feature maintained in parallel with the one
  actually in use.

Good engineering present in all three handlers: ping/pong keepalives,
read-deadline resets, single-writer-goroutine pattern, PTY resize via
`pty.Setsize`, process kill on cleanup.

**Test gap**: zero `_test.go` files for `exec.go`, `shell_stream.go`, or
`kcli_stream.go` — the three files that actually spawn PTYs and stream
WebSocket traffic. Only adjacent helpers are tested (`kcli_policy_test.go`,
`shell_complete_test.go`, `shell_status_test.go`).

### 4. "k9s Integration" — Not a real integration; a fragile, silently-failing alias

There is no k9s binary integration anywhere. What exists:

- `shell_stream.go:129` / `kcli_stream.go:315`:
  `alias k9s='"$KCLI_BIN" ui'` — inside the generated bash rc file, `k9s` is
  aliased to the **project's own separate CLI tool** (`vellankikoti/kcli`'s
  `ui` subcommand) — not the real k9s project.
- This alias is only created when `kcliErr == nil` from `resolveKCLIBinary()`
  (`kcli.go:170-213`), which checks `KCLI_BIN` env var → system `PATH` → a few
  `go install`-style user paths. `kcli.go:194` documents it explicitly as "an
  external binary... users may install via go install or download a release
  binary" — **it is not bundled for a normal end user.**
- **Consequence**: for anyone who hasn't separately installed `kcli`, the alias
  is silently never created. Typing `k9s` produces a plain
  `command not found: k9s`. The failure is logged server-side only
  (`shell_stream.go:138-147`) — nothing reaches the client, no status badge,
  no explanation anywhere in the UI.
- All other repo references to "k9s" are marketing comparison-table copy
  (README, PRD) or an AI system-prompt instruction — no actual embedding,
  launching, or rendering of k9s.

**Verdict: this is the strongest, most concrete basis for "worse than the worst
terminal I've seen."** A headline feature name resolves to an undocumented,
optional, silently-failing shell alias to a different binary.

### 5. Desktop/Tauri integration — Mid-migration, inconsistent

- The entire `kubilitics-desktop/` directory is deleted in the current
  uncommitted working tree (pre-existing, unrelated to this branch — **not
  touched by this investigation**), while git history shows active Tauri work
  as recently as `92b08d38`.
- Frontend terminal code still branches on `isTauri()`
  (`ClusterShellPanel.tsx:276-295`) to show a "Copy kubectl context" button —
  a feature whose entire rationale depends on a desktop wrapper that appears to
  be going away.
- `resolveKCLIBinary()`'s highest-priority check is the `KCLI_BIN` env var,
  documented as "set by Tauri sidecar or user" (`kcli.go:173`). If the sidecar
  goes away, the one mechanism that could have auto-provisioned `kcli` (and
  therefore the k9s alias) for end users disappears with no replacement.

### 6. State management — Minimal, fully ephemeral

- `uiStore.ts:15-26` tracks only `isShellOpen` and `shellHeightPx` for the
  global panel. No session IDs, no per-cluster history, no restore-on-reload.
- All real session state (`sessions[]`, active tab, xterm instances, WS refs)
  lives in local component state — lost on any reload/remount by design.
- `useNamespaceStore` integration for shell `cd`-context sync works correctly.

### 7. Routing / Open / Close UX

- Open: header Terminal icon (`Header.tsx:655-668`) for global shell; "Terminal"
  tab on resource detail pages for per-pod exec.
- Close: global panel has a real close button + per-tab close when >1 tab.
  Per-pod embedded terminal has **no close affordance at all** in the default
  single-session state (see §1).
- No working keyboard shortcut for open/close despite PRD claiming one.

### 8. Tests — Absent for the parts that matter

- Frontend: zero component/integration tests for any of the five terminal
  components. Only `shell.test.ts` exists, and it tests pure URL-string
  builders — no WebSocket, reconnect, rendering, or tab-management behavior.
- Backend: zero tests for the three handlers that actually spawn PTYs and
  stream bytes over WebSocket.

---

## Consolidated issue list (for task breakdown)

| # | Issue | Severity | Area |
|---|---|---|---|
| 1 | No close control on per-pod terminal in default (single-session) state | Critical | Frontend |
| 2 | Terminal sessions never cleaned up on navigate-away → PTY/WS leak | Critical | Frontend + Backend |
| 3 | "k9s" is a silently-failing alias to an unrelated, non-bundled binary | Critical | Backend / Product |
| 4 | Two unrelated terminal subsystems with no shared model or visual language | High | Architecture |
| 5 | `kcli_stream.go` is dead code — orphaned duplicate of `shell_stream.go` | Medium | Backend cleanup |
| 6 | Zero test coverage on all PTY/WebSocket handlers and all terminal UI components | High | Quality |
| 7 | PRD describes a nonexistent component (`TerminalViewer.tsx`) and an unimplemented shortcut (`⌘⇧T`) | Medium | Docs |
| 8 | No session restore after reload; no visible indicator of live background sessions | Medium | UX |
| 9 | `isTauri()`-gated features depend on a desktop wrapper that may be removed, with no fallback | Medium | Architecture |
| 10 | No shell/container selector exposed to user despite PRD mockup showing one | Low | UX |

---

## Next step

This document is investigation only — no design decisions yet. Before proposing
an approach (incremental fixes vs. unify-the-two-subsystems rebuild) I need your
input on scope and priority. See follow-up questions in chat.
