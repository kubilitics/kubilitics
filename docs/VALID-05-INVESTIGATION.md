# VALID-05 — Cluster Picker Cannot Connect Clusters Discovered via Non-Default KUBECONFIG Path

**Status: FIXED, LIVE-REPRODUCED, regression-tested. See §8 for the implementation record.**

**Severity: P1** — breaks the core "connect to a cluster" journey for any user whose active kubeconfig is not literally the default `~/.kube/config` file, including multi-file/merged `KUBECONFIG` setups. This directly affects the product's own documented target persona (enterprise architects managing 100+ clusters, typically via multiple or non-default kubeconfig files).

---

## 1. How it was found

While building the isolated Scale & Reliability Lab's browser-automation harness (Phase H, Playwright-driven), the lab backend was launched with `KUBECONFIG=/tmp/kubilitics-lab/kubeconfig.yaml` (a dedicated, non-default kubeconfig file — required by the lab's own isolation rules so the real `~/.kube/config` / real cluster are never touched). The backend's kubeconfig watcher auto-discovered and auto-registered the lab cluster correctly (`status: "connected"` from `GET /api/v1/clusters`). But clicking the resulting cluster card in the frontend's Cluster Picker never navigated to `/dashboard` — it silently failed with a toast and a `400 Bad Request`.

This was initially suspected to be a test-harness problem (wrong selector, timing). It is not — confirmed root cause below.

## 2. Exact reproduction

1. Start a Kubilitics backend with `KUBECONFIG` pointing at a kubeconfig file other than `~/.kube/config` (or a multi-path `KUBECONFIG=a:b`), containing a reachable cluster context not present in `~/.kube/config`.
2. Open the frontend. The cluster appears correctly in "Your clusters" (name, server URL, provider badge, green "Live" status) — discovery/registration/health-check all work.
3. Click the cluster card.
4. **Observed:** `POST /api/v1/clusters` is sent with body `{"kubeconfig_path":"~/.kube/config","context":"<name>"}`, which 400s: `failed to initialize k8s client: failed to build config: context "<name>" does not exist`. A toast error appears; the app never navigates away from the picker.

Verified directly against the backend (bypassing the frontend) for root-cause confirmation:
```
$ curl -s http://localhost:8199/api/v1/presence | python3 -m json.tool
{
  "registered": [
    {
      "identity": {"name": "kind-kubilitics-scale-lab", "server_url": "https://127.0.0.1:60763"},
      "source": "kubeconfig",
      ...
      "session_id": "e7460e6c-...",
      "provider": "Kind"
      # NOTE: no kubeconfig_path field — it does not exist in this response at all
    }
  ]
}

$ curl -s http://localhost:8199/api/v1/clusters | python3 -m json.tool
[{"id":"...", "kubeconfig_path":"/tmp/kubilitics-lab/kubeconfig.yaml", "status":"connected", ...}]
# This separate endpoint DOES carry kubeconfig_path — but the picker doesn't use it for its merge.
```

## 3. Root cause (CODE-PROVEN)

- `kubilitics-backend/internal/cluster/presence/types.go:23-52` — `RegisteredCluster` struct (the wire type served by `GET /api/v1/presence`, which `ClusterPickerPage` actually consumes via `useClusterPresenceStore`) has **no `kubeconfig_path` field whatsoever**. It carries `RegisteredAt`, `Reachable`, `LastCheckedAt`, `LastSuccessAt`, `LastError`, `SessionID`, `Provider` — but not the path.
- `kubilitics-frontend/src/pages/ClusterPickerPage.tsx:114` — `kubeconfigPath: r.kubeconfig_path ?? prev?.kubeconfigPath` — always falls through to `undefined` for presence-sourced entries, since the field doesn't exist on the wire.
- `kubilitics-frontend/src/pages/ClusterPickerPage.tsx:223` — `const kubePath = c.kubeconfigPath ?? '~/.kube/config';` — silently substitutes the hardcoded default.
- `kubilitics-frontend/src/pages/ClusterPickerPage.tsx:213-216,224` — `handlePick`: clusters with `source === 'kubeconfig'` and `isConnected === false` (presence-store's `connected` list, distinct from the backend's own per-cluster `status`, is empty until a session is actively joined — so a freshly-discovered-and-registered-but-not-yet-"connected-this-session" cluster always takes this branch) call `addCluster(backendUrl, kubePath, name)` with the wrong path, which 400s whenever the real kubeconfig differs from the default.

This is a genuine gap between two backend DTOs serving overlapping purposes (`/api/v1/clusters`'s full `Cluster` model vs. `/api/v1/presence`'s slimmer `RegisteredCluster`), where the frontend's actual data source (presence) is missing a field the other endpoint already has.

## 4. Who this affects in practice

Not a lab-only artifact. Reproduces for any real user whose kubeconfig is not literally `~/.kube/config`:
- `KUBECONFIG=/custom/path/config` (common for SSO-generated or per-project configs)
- `KUBECONFIG=~/.kube/config:~/.kube/other-config` (merged multi-file, common for managing many clusters)
- Any cluster added to the backend's watch set via a non-default path, then revisited in a later session before being "actively connected" in that session's presence state.

This directly contradicts the product's own stated target user (`user_architect_persona` — "manage 100+ clusters across AWS/Azure/GCP," who very plausibly use multiple/merged kubeconfig files rather than a single default file).

## 5. Why earlier phases didn't catch it

All prior VALID-0x work and the Phase A-D audit exercised the backend's own API/service layer directly (curl, Go tests) or used the real `kind-nightshift-dev` cluster, which happens to live in the default `~/.kube/config` — so the hardcoded-fallback bug never had a chance to surface. This is the first phase in the engagement that exercised the full real-browser click-to-connect user journey against a cluster registered via a non-default kubeconfig path.

## 6. Candidate fix (NOT implemented — for approval)

Smallest safe fix: add `KubeconfigPath` to `presence.RegisteredCluster` (mirroring the existing field already on the `Cluster` model used by `/api/v1/clusters`), populate it wherever `RegisteredCluster` values are constructed in the discovery/presence layer, and let the frontend's existing `r.kubeconfig_path ?? prev?.kubeconfigPath` mapping pick it up with no frontend code change required. This is additive (new optional JSON field), touches a shared DTO used by both the discovery manager and the REST handler, and needs a scan for every call site constructing a `RegisteredCluster` literal.

**Not implemented in this session** — awaiting approval, per the mission brief's explicit instruction not to modify production code during this investigation phase.

## 7. Impact on the Phase H measurement mission

This bug blocks the planned browser-automation journey (click cluster → Dashboard → Topology) for any cluster not registered via the default kubeconfig path — which includes the isolated lab's cluster, by the lab's own required design (dedicated, non-default `KUBECONFIG`, per the user's explicit lab-isolation requirements).

**Two ways forward for continuing Phase H's actual scale-profiling objective without this bug blocking it, neither requiring a production code change:**
- (a) Use the Cluster Picker's existing "Paste KubeConfig" / "Upload File" path instead of clicking an auto-discovered card — that flow calls `addClusterWithUpload` with the actual kubeconfig content (base64), bypassing the broken default-path fallback entirely. This is a legitimate, already-shipped product flow, not a workaround hack.
- (b) Temporarily point the lab's `KUBECONFIG` at a copy reachable via `~/.kube/config`'s default resolution — rejected, since it risks exactly the kind of accidental real-kubeconfig contact the lab's isolation rules exist to prevent.

Recommend (a). (This was used for Phase H's original frontend profiling, before this fix existed — see `docs/ENTERPRISE-SCALE-RELIABILITY-REPORT.md` §7.)

---

## 8. Implementation Record

**Decision:** implement the smallest-safe-fix exactly as proposed in §6 — thread `KubeconfigPath` (and `ContextName`, for completeness) through the existing data path, rather than invent any new mechanism. Confirmed via code tracing (REGISTER → PERSIST → LOAD → LIST → PICKER → CONNECT) that the information was never actually lost — `models.Cluster` (the DB row) already stores `kubeconfig_path`/`context` and `/api/v1/clusters` already returns them. The gap was entirely in the separate presence/discovery pipeline that `/api/v1/presence` (what the picker actually reads) is built from.

**Exact lifecycle trace (REGISTER → ... → CLIENT CACHE):**
1. `AddCluster` HTTP handler persists `kubeconfig_path`/`context` on the `Cluster` DB row — already correct, unchanged.
2. `clusterRepoAdapter.ListAll()` (`cmd/server/main.go`) reads DB rows via `repo.List()` and maps them to `discovery.StoredCluster` for `ManualSource` — **was dropping `KubeconfigPath`/`ContextName` here**. Fixed: now copies `r.KubeconfigPath` → `KubeconfigPath`, `r.Context` → `ContextName`.
3. `ManualSource.Enumerate()` (`internal/cluster/discovery/manual_source.go`) maps `StoredCluster` → `discovery.DiscoveredCluster` — **was dropping the same two fields again**. Fixed: both `StoredCluster` and the literal built in `Enumerate()` now carry them.
4. `Manager.Refresh()` (`internal/cluster/discovery/manager.go`) merges same-identity entries across sources — **already had working enrichment logic for these exact two fields** (lines 84-89, pre-existing, apparently written in anticipation of this fix but never fed real data). No change needed here.
5. `Manager.Snapshot()` promotes a `discovery.DiscoveredCluster` with a `SessionID` into `presence.RegisteredCluster` — **was dropping the fields a third time**, because the destination struct had nowhere to put them. Fixed: `presence.RegisteredCluster` gained `KubeconfigPath`/`ContextName` fields (`internal/cluster/presence/types.go`), and `Snapshot()` now copies them across.
6. `GET /api/v1/presence` serializes `presence.RegisteredCluster` to JSON — now includes `kubeconfig_path`/`context_name` automatically (existing `json:` tags, no handler change needed).
7. Frontend `ClusterPickerPage.tsx:114` (`kubeconfigPath: r.kubeconfig_path ?? prev?.kubeconfigPath`) — **already correctly written to consume this field**; it had simply never received a non-empty value. **Zero frontend code changed.**
8. `handlePick`'s `addCluster(backendUrl, kubePath, c.identity.name)` call (`ClusterPickerPage.tsx:223-224`) now receives the real path instead of falling through to `'~/.kube/config'`.

**Files changed (4, all backend, all additive):**
- `internal/cluster/presence/types.go` — +2 fields (`KubeconfigPath`, `ContextName`) on `RegisteredCluster`, both `omitempty`.
- `internal/cluster/discovery/manual_source.go` — +2 fields on `StoredCluster`; `Enumerate()` now populates them.
- `internal/cluster/discovery/manager.go` — `Snapshot()` now copies the 2 fields into the `presence.RegisteredCluster` literal.
- `cmd/server/main.go` — `clusterRepoAdapter.ListAll()` now copies `r.KubeconfigPath`/`r.Context` into the `discovery.StoredCluster` literal.

**Why this satisfies every §3 requirement:**
- Default `~/.kube/config` behavior: unchanged — those entries simply have `KubeconfigPath == ""` same as before (regression-tested: `TestManager_Snapshot_EmptyKubeconfigPathStaysEmpty`).
- Explicitly-supplied / uploaded kubeconfigs: unaffected — `addClusterWithUpload`'s path doesn't go through `handlePick`'s fallback logic at all.
- Merged kubeconfig: covered by the pre-existing cross-source enrichment in `Manager.Refresh()`, now regression-tested (`TestManager_Refresh_EnrichesKubeconfigPathAcrossSources`).
- In-cluster registration: unaffected — in-cluster sources never set `KubeconfigPath`, stays empty, no new code path touches them.
- No duplicate reconnect mechanism created, no new abstraction — reused the exact existing `AddCluster`/`handlePick` flow, just gave it the data it was always supposed to have.
- No secrets introduced or newly exposed — a kubeconfig **path** is not credential material, and was already returned by the separate `/api/v1/clusters` endpoint before this fix; this only makes `/api/v1/presence` consistent with it.

**Tests added (5, all backend, all new-file-or-appended to existing suites):**
1. `TestManualSource_EnumerateCarriesKubeconfigPathAndContext` (`manual_source_test.go`) — path/context survive `Enumerate()`; a cluster with neither stays empty, doesn't panic.
2. `TestManager_Snapshot_PropagatesKubeconfigPathAndContext` (`manager_test.go`) — path/context survive promotion into `presence.RegisteredCluster`.
3. `TestManager_Snapshot_EmptyKubeconfigPathStaysEmpty` (`manager_test.go`) — default-kubeconfig regression guard.
4. `TestManager_Refresh_EnrichesKubeconfigPathAcrossSources` (`manager_test.go`) — the merged-kubeconfig scenario (cluster seen by two sources, one has the path, one doesn't; final entry has it).
5. `TestClusterRepoAdapter_ListAll_PropagatesKubeconfigPathAndContext` (new file `cmd/server/cluster_repo_adapter_test.go`) — the DB-row → adapter hop, including a nil-row defensive case.

**Revert-and-reconfirm:** all 4 production files' VALID-05 additions were manually reverted (not via `git checkout`, since these files had pre-existing unrelated uncommitted changes from earlier phases that must not be discarded) and the 5 new tests were re-run — confirmed **compile failure** (`got.KubeconfigPath undefined`, etc.) referencing exactly the fields this fix adds, across both affected packages. Fix was then restored and all 5 tests re-confirmed passing.

**Full regression:** `go build ./...` clean, `go vet ./...` clean, `go test ./... -race -count=1` — **every package `ok`**, including `internal/cluster/discovery` and `cmd/server` (the two touched). VALID-02 and VALID-04's own regression suites re-run explicitly and confirmed passing (VALID-01/03 live in packages covered by the same full-suite run).

**Live reproduction (LIVE-REPRODUCED, not just unit-tested):** a fresh, genuinely isolated kind cluster (`kubilitics-valid05-check`) was registered against the **fixed** backend binary via its own non-default `KUBECONFIG` file (`/tmp/kubilitics-lab/kubeconfig2.yaml`), with **no sandboxed-`HOME` workaround this time** (confirmed: `GET /api/v1/presence` now returns `"kubeconfig_path":"/tmp/kubilitics-lab/kubeconfig2.yaml"` and `"context_name":"kind-kubilitics-valid05-check"`). A real Chromium browser (Playwright) loaded the actual frontend, clicked the cluster card directly — the exact interaction that previously 400'd — and:
- `POST /api/v1/clusters` → **201** (previously 400 with `context "..." does not exist`)
- Browser navigated to `/dashboard` (previously stuck on the picker)
- Dashboard rendered correctly: "Cluster Health — Good State — 100 Grade A", "9 active pods" (matching the fresh cluster's real pod count), correct cluster name in the header

Both the real `~/.kube/config` and `kind-nightshift-dev` context were independently re-verified untouched throughout (`kubectl config current-context` → `kind-nightshift-dev`, pod count unchanged at 20) and the verification cluster/processes were torn down afterward.

**Remaining risk:** none identified for this specific fix. `ContextName` is populated but not yet consumed by any frontend code (only `KubeconfigPath` was load-bearing for the bug) — harmless, available for future use, not a loose end that needs closing now.
