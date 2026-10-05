# Cluster Terminal (Global Shell) — Rebuild Spec

**Date**: 2026-10-02
**Branch**: `feat/terminal`
**Scope**: Global "Cluster Shell" terminal only (header Terminal icon →
`ClusterShellPanel` / `ShellSession` / `shell_stream.go`). The per-pod/workload
exec terminal (`PodTerminal`/`MultiTerminal`/`exec.go`) is explicitly out of
scope — confirmed stable, not touched.

See [docs/TERMINAL-GAP-ANALYSIS.md](TERMINAL-GAP-ANALYSIS.md) for the full
investigation this spec is based on.

## Goals

1. Session close/lifecycle is unambiguous: every tab is closeable, closing a
   session actually terminates its backend PTY, no zombie connections.
2. The "k9s" alias is either real (kcli is genuinely bundled and resolves for
   every packaged release) or the failure is visible to the user — never
   silent `command not found`.
3. Remove the orphaned `kcli_stream.go` duplicate backend path.
4. The PTY/WebSocket mechanism and the panel's session lifecycle have test
   coverage, since today there is none on the code that actually matters.
5. Docs describing this feature match what's shipped.

## Non-goals

- No changes to `PodTerminal.tsx`, `MultiTerminal.tsx`, `WorkloadTerminalTab.tsx`,
  or `exec.go`.
- No unification of the two terminal subsystems (per explicit decision — they
  stay independent).
- No new terminal features beyond what's listed (e.g. no session persistence
  across reload, no shell-selector UI) unless they fall out of fixing the above.

## Current architecture (for reference)

- `Header.tsx:826` renders `<ClusterShellPanel>` only when `shellOpen` is true
  (conditional mount/unmount, not CSS-hidden) — so panel-level close already
  fully tears down the React tree.
- `ClusterShellPanel.tsx` owns `sessions: SessionEntry[]` (max 8) and renders
  one `<ShellSession>` per tab.
- `ShellSession.tsx` owns the WebSocket + xterm instance for one tab; has
  cleanup-on-unmount (closes the WS, line ~467-483) and reconnect-with-backoff
  (max 5 attempts).
- `shell_stream.go` (`GetShellStream`) spawns a local PTY running bash/sh with
  `KUBECONFIG` set, writes an rc file that (if kcli resolves) aliases `k9s` to
  `kcli ui`, and streams bytes over the WebSocket.
- `kcli.go:resolveKCLIBinary()` resolution order: `KCLI_BIN` env (set by the
  Tauri sidecar) → system `PATH` → a few hardcoded user-local paths.
- `kubilitics-desktop/src-tauri/src/sidecar.rs` already resolves a bundled
  `binaries/kcli-<target-triple>` and sets `KCLI_BIN` for the backend sidecar
  process — this logic exists and looks correct, but nothing produces the
  binary it expects: `scripts/fetch-kcli.sh` exists but is invoked by nothing
  in `kubilitics-desktop/package.json` or `.github/workflows/`.

## Design

### A. Close / session lifecycle

- **Tab close button**: remove the `sessions.length > 1 &&` gate in
  `ClusterShellPanel.tsx` (~line 228) so a single remaining tab is closeable
  too. Closing the last tab closes the whole panel (existing behavior in
  `closeSession`, ~line 84-107) — keep that, it's correct UX (closing your
  only shell = closing the terminal).
- **Actual termination on close**: confirm (and add a regression test for)
  that `ShellSession`'s unmount effect reliably closes the WebSocket, and that
  the backend's `shell_stream.go` cleanup path (process kill, ~line 187-190)
  fires when the WS closes from the client side — not just on server shutdown.
  If there's any path where the goroutine/process can outlive the closed
  WebSocket (e.g. blocked read not interrupted), fix it.
- **Visible state**: keep the existing connected/connecting indicator dots
  per tab (already implemented) — no change needed there, just confirmed in
  scope as "working, keep."

### B. Real kcli/k9s bundling

1. Add a step to `kubilitics-desktop/package.json`'s `build`/`build:frontend`
   script (or a new `prebuild` script) that runs `scripts/fetch-kcli.sh` with
   `KCLI_VERSION` read from `kubilitics-backend/KCLI_VERSION` (currently
   `v1.0.0`), before `tauri build` runs. This must happen for every target
   platform in CI (mac/linux per the script's current platform support —
   confirm Windows is handled or explicitly excluded).
2. Wire the same step into whatever GitHub Actions release workflow builds
   the desktop app, so released artifacts always carry a real `kcli` binary
   under `kubilitics-desktop/src-tauri/binaries/`.
3. Add a smoke check (CI or local `make`/script target) that asserts the
   binary exists and `kcli version` exits 0 before packaging continues — fail
   the build loudly instead of silently shipping without it.
4. Backend: when `resolveKCLIBinary()` fails, have `shell_stream.go` write a
   one-line notice into the rc file (e.g. a shell function for `k9s` that
   echoes "k9s unavailable: kcli not found in this build" and exits non-zero)
   instead of leaving `k9s` as an undefined command with a bare
   `command not found`. This is the fallback for non-Tauri/dev-mode runs
   where bundling doesn't apply.

### C. Delete dead code

- Remove `kubilitics-backend/internal/api/rest/kcli_stream.go`.
- Remove its route registration in `handler.go:597`.
- Remove `getKCLIShellStreamUrl` and any exclusively-dead exports from
  `kubilitics-frontend/src/services/api/shell.ts`, and the corresponding
  assertions in `shell.test.ts`.
- Grep for any other references before deleting to confirm zero callers
  remain (already confirmed in the gap analysis, re-verify at implementation
  time in case of drift).

### D. Test coverage

- Backend (`shell_stream_test.go`, new): spawn a real PTY against a test
  harness, assert resize via `pty.Setsize` works, assert ping/pong keeps the
  connection alive, assert process is killed when the WebSocket closes.
- Frontend: component tests for `ClusterShellPanel` covering — tab close
  always visible, closing the only tab closes the panel, closing a
  non-active tab doesn't disturb the active one, max-8-sessions toast.
  `ShellSession` test(s) covering WS cleanup on unmount.

### E. Docs

- Update `kubilitics-frontend/docs/PRD.md` sections describing the cluster
  shell / k9s alias to match what's actually shipped after this work. Drop
  any remaining references specific to the per-pod terminal's stale claims
  only if they're mixed into the same section as the cluster shell (don't
  touch pod-terminal-only doc sections).

## Testing / verification plan

- Unit tests per component above, run via existing `go test` / `npm test`.
- Manual verification in the running desktop app (via this session's browser
  preview / iOS-simulator-equivalent tooling is not applicable here — this is
  a Tauri desktop app, so manual verification means running
  `kubilitics-desktop` locally): open cluster shell, open 1 tab, confirm close
  button visible and works; open multiple tabs, close each; type `k9s` and
  confirm either it launches `kcli ui` or shows the new clear fallback
  message; confirm closing a tab actually kills the server-side process
  (check backend logs / process list during a manual test).

## Task breakdown (implementation order)

1. Backend: delete `kcli_stream.go` + route + dead frontend URL builder (C)
2. Backend: add test coverage for `shell_stream.go` (D, backend half) —
   establish a safety net before touching its behavior
3. Backend: kcli-not-found fallback message in generated rc file (B.4)
4. Frontend: fix tab close button gating + verify/fix WS-close-on-unmount →
   PTY-kill path end to end (A)
5. Frontend: test coverage for `ClusterShellPanel`/`ShellSession` lifecycle (D, frontend half)
6. Build pipeline: wire `fetch-kcli.sh` into desktop build + CI release workflow, pin version, add existence/smoke check (B.1-B.3)
7. Docs: correct PRD sections for the cluster shell (E)
8. Manual end-to-end verification in the running desktop app
