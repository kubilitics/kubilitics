# Agent Registration & Trust Model — Design

**Date:** 2026-04-18
**Status:** Approved for planning
**Scope:** Hub ↔ Agent registration, identity, and trust. This spec is a prerequisite for the RBAC, OIDC, and data-plane specs that follow.

---

## 1. Context & Scope

Kubilitics uses a hub-and-spoke topology. The hub runs in one central cluster; an agent pod runs in every managed cluster and pushes data outbound to the hub. This spec defines how an agent proves its identity, joins the hub, holds a credential over time, and recovers from failure.

**In scope**
- Agent registration flows (same-cluster auto-discovery + remote token).
- Cluster identity (`cluster_uid`, `cluster_id`, `cluster_name`).
- Bootstrap token format, lifecycle, revocation.
- Post-registration credential (refresh + access JWT pair).
- Secure channel + impersonation prevention.
- Registration, refresh, and heartbeat APIs.
- Persistence model for clusters, bootstrap tokens, and agent credentials.
- Agent state machine and failure handling.

**Deferred to later specs**
- OIDC login for human users (next spec: AuthN).
- Kubilitics-native RBAC enforcement on API requests (spec after AuthN).
- Agent → Hub data plane (topology/events/metrics payloads).
- Hub → Agent command channel beyond the heartbeat `commands[]` field.
- Admin UI for user/role/cluster management.

The `organizations` table appears as a stub so registration is not floating; the RBAC spec will extend it.

---

## 2. Architecture Overview

```
   ┌────────────────────────────────────────────┐
   │                Hub Cluster                 │
   │   ┌────────────┐   ┌─────────────────┐     │
   │   │ Hub API    │◄──┤ Same-cluster    │     │
   │   │ (Go)       │   │ agent pod       │     │
   │   │            │   └─────────────────┘     │
   │   │  TokenRev  │──► K8s API (local)        │
   │   └─────┬──────┘                           │
   │         │ outbound HTTPS (TLS + JWT)       │
   └─────────┼──────────────────────────────────┘
             │
   ┌─────────┼──────────────┐  ┌────────────────────┐
   │  Remote Cluster A      │  │  Remote Cluster B  │
   │  ┌──────────────┐      │  │  ┌──────────────┐  │
   │  │ Agent Pod    │──────┼──┼─►│ Agent Pod    │  │
   │  │ (Go)         │      │  │  │ (Go)         │  │
   │  └──────────────┘      │  │  └──────────────┘  │
   └────────────────────────┘  └────────────────────┘

All arrows agent → hub are outbound-initiated. Hub never dials agents.
```

---

## 3. Registration Flows

### 3.1 Same-cluster (auto-discovery)

```
Agent Pod                          Hub (same cluster)              K8s API
   │                                    │                            │
   │ read /var/run/…/serviceaccount     │                            │
   │ resolve kubilitics-hub.kubilitics- │                            │
   │        system.svc.cluster.local    │                            │
   │ POST /api/v1/agent/register ──────►│                            │
   │ { sa_token, cluster_uid,           │                            │
   │   cluster_name?, versions }        │                            │
   │                                    │ TokenReview(sa_token) ────►│
   │                                    │◄─── authenticated user ────│
   │                                    │ verify cluster_uid matches │
   │                                    │ hub's kube-system NS UID   │
   │                                    │ upsert clusters row        │
   │                                    │ mint refresh + access      │
   │◄── 200 { cluster_id, refresh,      │                            │
   │          access, ttl, hb_interval }│                            │
   │ write Secret kubilitics-agent-creds                             │
   │ start heartbeat loop                                            │
```

- Agent has a ServiceAccount with `get` on `namespaces` (to read `kube-system` UID) and permission to manage its own Secret.
- The hub rejects same-cluster registration if `cluster_uid` from the payload does not equal the kube-system NS UID seen by its own K8s client — this is what proves the agent is in the hub's cluster.
- No bootstrap token used on this path.

### 3.2 Remote cluster (token-based)

```
Admin (UI)        Hub                             Agent Pod (remote)
   │ click Add     │                                    │
   │ Cluster ────►│                                    │
   │               │ generate bootstrap JWT,            │
   │               │ insert bootstrap_tokens row        │
   │◄─ helm cmd +  │                                    │
   │   token       │                                    │
   │── runs `helm install kubilitics-agent …` ─────────►│
   │               │                                    │ pod starts
   │               │◄── POST /api/v1/agent/register ────│
   │               │    { bootstrap_token,              │
   │               │      cluster_uid, cluster_name?,   │
   │               │      versions }                    │
   │               │ validate JWT: sig, exp, jti unused,│
   │               │ not revoked → mark used_at         │
   │               │ upsert clusters row                │
   │               │ mint refresh + access              │
   │               │──── 200 { creds } ────────────────►│
   │               │                                    │ write Secret
   │               │◄────────── heartbeats ─────────────│
```

---

## 4. Cluster Identity

| Field | Source | Purpose |
|---|---|---|
| `cluster_uid` | UID of the `kube-system` Namespace | Stable external identity. Survives agent reinstall. |
| `cluster_id` | UUIDv4 minted by hub on first register | Surrogate key used throughout Kubilitics DB. |
| `cluster_name` | User input (Helm value or UI); fallback to kubecontext name or `cluster-<first-6-of-cluster_uid>` | Human label. Editable. Not used for identity. |

- **Uniqueness:** `UNIQUE (organization_id, cluster_uid)`.
- **Re-registration:**
  - Same `cluster_uid` + valid bootstrap or refresh token → rotate credentials, keep `cluster_id`.
  - Same `cluster_uid` but presented credential does not match → `409 Conflict`. Admin resolves via explicit "Reset cluster" in UI, which sets `credential_epoch += 1` and revokes existing refresh rows.
- **`cluster_uid` change on heartbeat** (e.g., hub DB restored into a different cluster): `410 Gone`, agent re-registers, old row marked `superseded`.

---

## 5. Authentication & Trust Model

### 5.1 Bootstrap token

- **Format:** JWT signed HS256 with the hub's signing secret (stored in a K8s Secret in the hub namespace; rotatable).
- **Claims:** `{ iss: "kubilitics-hub", typ: "bootstrap", jti: uuid, org_id, created_by, iat, exp }`
- **Default TTL:** 24 h. Configurable range: 15 min – 7 days.
- **Single-use:** `jti` is written to `bootstrap_tokens` at creation and marked `used_at` on first successful exchange. Replay → 401.
- **Revocation:** admin action sets `revoked_at`. Validator checks this plus `used_at` and `exp`.
- **Why HMAC, not RSA:** a single hub (or an HA set sharing one signing secret) issues and validates. Asymmetric keys add cost without benefit today. JWKS migration is a header swap if we need it later.

### 5.2 Post-registration credential — Refresh + Access JWT pair

| Option | Decision |
|---|---|
| mTLS | **Rejected.** Strongest binding, but per-agent cert issuance/rotation across 100+ clusters is operational pain and breaks behind corporate TLS-intercepting proxies. |
| Static API key | **Rejected.** No expiry, no rotation, pure bearer — one leak is forever. |
| Refresh + access JWT pair | **Chosen.** Rotation is built in, access validation is stateless, the wire format is firewall-friendly, and refresh tokens are individually revocable. |

- **Access token:** JWT, 1 h TTL. Claims: `{ sub: cluster_id, typ: "access", org_id, epoch, scope: "agent", exp }`. Stateless validation; not persisted. `epoch` is compared against `clusters.credential_epoch` to force immediate logout on admin reset.
- **Refresh token:** opaque 32-byte base64url string (`rk_live_…`). 1-year TTL. Stored **hashed** (argon2id) in `agent_credentials`. Agent refreshes access ~10 min before expiry.
- **Revocation:** `revoked_at` on the refresh row, or bump `clusters.credential_epoch` to kill all outstanding access tokens for that cluster at once.

---

## 6. Secure Communication

- **Direction:** agent → hub only. Hub never dials agents. Works behind NAT and private clusters.
- **Transport:** HTTPS/TLS 1.2+ mandatory. Plain HTTP is refused by the agent at startup with a clear error.
- **Trust:** system CA pool by default. For private CAs, Helm chart accepts `hub.caBundle` (PEM) which the agent pins. A `hub.tlsInsecureSkipVerify: true` exists for local dev only and emits a loud warning log on every request.
- **Impersonation prevention:**
  - TLS pinning of the hub CA blocks rogue-cert MITM.
  - Access JWT is bound to `cluster_id`; another cluster's stolen token cannot masquerade because the hub cross-checks `cluster_uid` on heartbeat and the `epoch` in the token.
  - `credential_epoch` bump lets an admin force-log-out a suspected compromised agent.
- **Rate limiting:** per-cluster token bucket on the hub (default 10 req/s, burst 50). Blunts a compromised agent without starving normal heartbeats.

---

## 7. API Contracts

### 7.1 `POST /api/v1/agent/register`

**Request**
```json
{
  "bootstrap_token": "eyJ...",          // required for remote; omitted for same-cluster
  "sa_token": "eyJ...",                 // required for same-cluster; omitted for remote
  "cluster_uid": "b3e1c5f4-…-ns-uid",
  "cluster_name": "prod-eu-west-1",     // optional
  "agent_version": "0.4.0",
  "k8s_version": "v1.29.3",
  "node_count": 12
}
```

**Response `200`**
```json
{
  "cluster_id": "7c9e6679-…",
  "refresh_token": "rk_live_…",
  "access_token": "eyJ…",
  "access_ttl_s": 3600,
  "heartbeat_interval_s": 30
}
```

**Errors**
| Code | Meaning |
|---|---|
| `400` | Malformed payload. |
| `401` | Bootstrap token invalid / expired / used / revoked; or SA TokenReview failed. |
| `403` | Same-cluster path: SA authenticated but cluster_uid does not match hub's. |
| `409` | `cluster_uid` already registered with different credential and no valid re-registration proof. |

### 7.2 `POST /api/v1/agent/token/refresh`

**Request** `{ "refresh_token": "rk_live_…" }`
**Response** `{ "access_token": "…", "access_ttl_s": 3600 }`
**Errors** `401` with `code` in `{refresh_invalid, refresh_expired, refresh_revoked, epoch_mismatch}`.

### 7.3 `POST /api/v1/agent/heartbeat`

**Headers** `Authorization: Bearer <access>`

**Request**
```json
{
  "cluster_id": "7c9e6679-…",
  "cluster_uid": "b3e1…",
  "agent_version": "0.4.0",
  "k8s_version": "v1.29.3",
  "status": "healthy",
  "resource_counts": { "nodes": 12, "pods": 342, "namespaces": 18 },
  "last_reconcile_ts": "2026-04-18T09:00:00Z"
}
```

**Response**
```json
{
  "ack": true,
  "desired_agent_version": "0.4.1",
  "commands": [ { "id": "…", "type": "full_resync" } ]
}
```

- Heartbeat carries `cluster_uid`; a mismatch against the stored row triggers `410 Gone` and forces re-registration.
- `commands[]` is reserved; only `full_resync` is honored in this spec.

---

## 8. Agent Lifecycle (State Machine)

```
INSTALLED ──register──► REGISTERING ──ok──► ACTIVE
                             │                 │
                        fail (backoff)    missed N heartbeats
                             │                 │
                             ▼                 ▼
                          FAILED           DEGRADED ──miss more──► OFFLINE
                                               │                      │
                                          heartbeat resumes ◄──────────┘
                                               │
                                               ▼
                                             ACTIVE
```

- **First install:** pod starts → registers → writes `kubilitics-agent-creds` Secret (owner-ref on the agent Deployment for uninstall cleanup) → starts heartbeats.
- **Restart:** reads Secret → skips registration → refreshes access token → heartbeats.
- **Reconnect:** exponential backoff 1 s → 60 s cap with full jitter. Recent heartbeat payloads kept in an in-memory ring buffer (volatile; no disk queue).
- **Upgrade:** `helm upgrade` replaces the pod. The credentials Secret has its owner-ref on the agent's ServiceAccount (not the Deployment), so it survives pod replacement and is cleaned up only on chart uninstall. Agent re-reads it and continues. Hub reports `desired_agent_version` in the heartbeat ack for observability; the actual upgrade is an admin action (`helm upgrade`).
- **Status on hub side:** `ACTIVE` when heartbeat arrived within `2 × hb_interval`; `DEGRADED` after 2 misses; `OFFLINE` after 10.

---

## 9. Failure Handling

| Scenario | Behavior |
|---|---|
| Invalid bootstrap token | `401`; agent CrashLoopBackoff; admin intervention needed. |
| Expired bootstrap token | `401 code=token_expired`; same as above. |
| Access token expired | Agent catches `401 code=access_expired`, calls `/token/refresh`, retries original request. |
| Refresh token revoked/expired | `401 code=refresh_invalid`; agent clears Secret, returns to `REGISTERING`. Fails until a new bootstrap token is provided. Metric `kubilitics_agent_auth_failed_total` incremented. |
| `epoch_mismatch` | Agent treats as revoked refresh (same recovery). |
| Hub unreachable | Backoff + retry indefinitely. Hub side flips `DEGRADED` → `OFFLINE` by heartbeat age. |
| Duplicate cluster | `409`; visible in UI. Admin runs "Reset cluster". |
| DB restored into new cluster | Heartbeat `cluster_uid` mismatch → `410 Gone`; agent re-registers; old row marked `superseded`. |

---

## 10. Data Persistence

```sql
-- Minimal tenancy stub; extended by the RBAC spec.
CREATE TABLE organizations (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clusters (
  id                 UUID PRIMARY KEY,
  organization_id    UUID NOT NULL REFERENCES organizations(id),
  cluster_uid        TEXT NOT NULL,                  -- kube-system NS UID
  name               TEXT NOT NULL,
  k8s_version        TEXT,
  agent_version      TEXT,
  node_count         INTEGER,
  status             TEXT NOT NULL,                  -- registering|active|degraded|offline|superseded
  credential_epoch   INTEGER NOT NULL DEFAULT 1,
  registered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at  TIMESTAMPTZ,
  UNIQUE (organization_id, cluster_uid)
);

CREATE TABLE bootstrap_tokens (
  jti              UUID PRIMARY KEY,
  organization_id  UUID NOT NULL REFERENCES organizations(id),
  created_by       UUID NOT NULL,                    -- user id
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  used_by_cluster  UUID REFERENCES clusters(id),
  revoked_at       TIMESTAMPTZ
);

CREATE TABLE agent_credentials (
  id                  UUID PRIMARY KEY,
  cluster_id          UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  refresh_token_hash  TEXT NOT NULL,                 -- argon2id
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  last_used_at        TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  credential_epoch    INTEGER NOT NULL
);

CREATE INDEX idx_clusters_heartbeat ON clusters(last_heartbeat_at);
CREATE INDEX idx_creds_cluster      ON agent_credentials(cluster_id) WHERE revoked_at IS NULL;
```

**Not stored:**
- Access tokens (stateless JWTs, signature-verified on every request).
- Raw refresh tokens (argon2id hashes only).
- SA tokens from the same-cluster path (used once for TokenReview, discarded).

---

## 11. Unit & Integration Boundaries (for the implementation plan)

Each unit has one purpose, a typed interface, and can be tested in isolation.

| Unit | Purpose | Depends on |
|---|---|---|
| `trust/signer` | Issue + verify bootstrap and access JWTs. | hub signing secret |
| `trust/refresh` | Generate, hash, verify, revoke refresh tokens. | DB |
| `trust/epoch` | Read/bump `credential_epoch`; validate claims. | DB |
| `registration/handler` | Implement `/register` for both paths. | `trust/signer`, `trust/refresh`, K8s TokenReview client, DB |
| `heartbeat/handler` | Validate access JWT, update cluster status, emit commands. | `trust/signer`, `trust/epoch`, DB |
| `agent/bootstrap` | Agent-side: detect same vs remote, perform registration. | Helm values, K8s client |
| `agent/credential_store` | Read/write `kubilitics-agent-creds` Secret. | K8s client |
| `agent/heartbeat_loop` | Send heartbeats, handle 401/410/409 reactions. | `agent/credential_store`, HTTP client |

---

## 12. Test Strategy

- **Unit:** each unit above, happy + each failure code.
- **Integration (hub):** in-memory DB + fake K8s TokenReview; exercise every row in §9.
- **Integration (agent):** fake hub server; verify Secret read/write, backoff, re-registration on `410`, refresh on `access_expired`.
- **End-to-end (kind):** deploy hub + same-cluster agent, register, rotate access, bump epoch, confirm agent recovers; then deploy a second kind cluster with a bootstrap-token agent, same checks.

---

## 13. Open Questions (tracked; non-blocking)

1. Should `organizations` default to a single auto-created "default" org for fresh installs? (Leaning yes; confirm in RBAC spec.)
2. Do we expose `credential_epoch` reset via API now, or only via UI (post-UI spec)? (Leaning: internal admin API first, UI later.)
3. Retention policy for `superseded` cluster rows. (Default 90 days; revisit after RBAC.)

These do not block implementation; they will be settled before the respective touching specs.
