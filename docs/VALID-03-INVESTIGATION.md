# VALID-03 — Password-reset token logged in plaintext to application logs

**Status: FIXED, TESTED, REGRESSION-VALIDATED. See §13 for the implementation record.**

## 1. Finding

`POST /auth/forgot-password` writes the newly-generated, valid, unexpired password-reset token in **plaintext** to the application's standard log stream, for any user who requests a password reset.

## 2. Severity

**P1, with P0-adjacent characteristics.** This is not a cross-cluster or Kubernetes-API-layer finding (unlike every other finding in this engagement) — it is an **authentication/account-security boundary violation**: possession of this token is sufficient, on its own, to reset any targeted user's password and take over their account, within the token's 1-hour validity window, by anyone with read access to the application's logs.

## 3. Exact reproduction

```
POST /auth/forgot-password
Content-Type: application/json

{"username": "<any valid username>"}
```

With `AuthMode` set to `"optional"` or `"required"` (not the default `"disabled"`). The response is always a generic 200 ("If the username exists..."), by design, to prevent username enumeration — but server-side, if the user exists, the following line executes unconditionally:

```go
log.Printf("[password-reset] Token for user %s: %s (expires in 1 hour)", user.Username, tokenPlaintext)
```

`tokenPlaintext` is the actual, live, usable reset token (`uuid.New().String() + uuid.New().String()`), written in full to whatever log sink `log.Printf` is configured to write to (stdout, a file, a log-aggregation pipeline, a cloud logging service, CI debug output, etc.).

## 4. Customer impact

Anyone with read access to the backend's application logs — an operator, an on-call engineer, a log-aggregation service, a misconfigured log-forwarding pipeline, or an attacker who has compromised log infrastructure (a much broader and often less-guarded attack surface than the primary database) — can read this token and call `POST /auth/reset-password` with it to set a new password for the targeted account, including an **admin** account, within the 1-hour expiry window. This is a full account-takeover path requiring no prior credentials for the target account — only log read access.

This is gated behind `AuthMode != "disabled"`. `AuthMode` defaults to `"disabled"` (`viper.SetDefault("auth_mode", "disabled")`), so this is **not reachable in Kubilitics' default, out-of-the-box configuration**. It becomes reachable specifically for deployments that have explicitly turned authentication **on** — which is the more security-conscious, typically production-intended configuration. The operators most likely to be affected are exactly the ones who took the extra step to enable auth.

## 5. Evidence

`internal/api/rest/auth.go`:
- Line 160: `router.HandleFunc("/auth/forgot-password", h.ForgotPassword).Methods("POST")` — confirms the route is live and registered unconditionally (pre-authentication endpoints cannot themselves require auth, by necessity).
- Lines 1815-1818: the only gate is `if h.cfg.AuthMode == "disabled" { respondError(...); return }` — confirms the endpoint is reachable whenever auth is enabled.
- Lines 1849-1867 (full function body read): token generation (`uuid.New().String() + uuid.New().String()`, 1-hour expiry), correctly hashed for storage (`auth.HashPassword(tokenPlaintext)` into `TokenHash`) — the **storage** side is done correctly (the plaintext token is never persisted to the database, only its hash). The violation is specifically the `log.Printf` call immediately after, which the code's own comment self-acknowledges: `// In production: send email with reset link containing tokenPlaintext` / `// For now, log it (in production, never log tokens)`.
- This is a self-documented placeholder for an unimplemented email-delivery mechanism, not an accidental leak — the developer intended this as temporary, local-testing scaffolding, but there is no feature flag, environment check, or build-tag distinguishing "local/dev" from "production" at this call site. It runs identically regardless of deployment environment.

## 6. Exact code path

```
POST /auth/forgot-password
  → AuthHandler.ForgotPassword (internal/api/rest/auth.go:1814)
      → AuthMode == "disabled"? → 400, stop (safe path)
      → else: respond 200 (generic, anti-enumeration) FIRST
      → if user exists:
          → generate tokenPlaintext
          → hash and persist TokenHash only (correct)
          → log.Printf(... tokenPlaintext ...)   ← VIOLATION: plaintext credential to log stream
          → h.logAuthEvent(...)  — a separate, legitimate audit-log call that does NOT include the token
```

## 7. Root cause

An unimplemented feature (outbound password-reset email delivery) was stubbed with a `log.Printf` of the live token as placeholder scaffolding, with a comment acknowledging the gap, but without any mechanism (build tag, environment check, feature flag, log-level gate) to prevent that placeholder from running in a real deployment.

## 8. Why existing phases did not catch it

None of Phase 0-11's audit, VALID-01, or VALID-02 examined the authentication subsystem — every finding in this entire engagement to date has been in the Kubernetes-cluster-connectivity/data-correctness domain (reconnect logic, topology, blast radius, metrics, WebSocket cluster scoping). `internal/api/rest/auth.go` was never in scope for any prior phase. This finding surfaced only because this continuation's Section 6F explicitly requested a focused security/RBAC/secret-handling review, which is new scope relative to everything before it.

## 9. Candidate fixes (not implemented — for review only)

1. **Smallest, most direct fix:** delete the `log.Printf` line entirely. The token is already correctly delivered to the only place that needs it (the hashed row in the database); logging the plaintext was never functionally necessary — it was debugging/placeholder scaffolding, not a dependency of the reset flow itself. Removing it costs nothing functionally and closes the leak completely.
2. **If local-development visibility into the token is still wanted** (e.g., because email delivery genuinely isn't implemented yet and a developer needs *some* way to retrieve the token to test the reset flow end-to-end): gate the log line behind an explicit, narrowly-scoped development-only flag (e.g., `cfg.DevMode` or similar, defaulting false, documented as "never enable in production"), and additionally consider logging only a truncated/masked prefix rather than the full token even in that mode.
3. **Longer-term, out of scope for a "smallest safe fix":** implement actual email delivery for the reset link, which removes the need for any log-based workaround entirely. Not proposed as part of this finding's fix — a larger, separate unit of work.

Candidate 1 is the recommended minimal fix, pending approval — it is a one-line deletion with no behavioral change to the actual reset flow (which never depended on the log line).

## 10. Required regression tests (not written — pending approval to implement)

1. A test asserting `ForgotPassword` never writes the plaintext token to any log output (e.g., capture `log` output in-test and assert the token string is absent) — must be proven to fail against current code, then pass after the fix.
2. Existing reset-flow tests (if any) must continue to pass unchanged, confirming the fix doesn't alter the functional reset flow (token generation, hashing, storage, expiry).
3. Confirm `h.logAuthEvent`'s own audit-log call (a legitimate, separate mechanism) continues to correctly record that a reset was requested, without the token.

## 11. Acceptance criteria (for a future, approved fix)

- No plaintext password-reset token appears in any log output under any `AuthMode` setting.
- The reset flow's functional behavior (token generation, hashing, database storage, 1-hour expiry, generic anti-enumeration response) is unchanged.
- A regression test proves the fix and is proven to fail against the pre-fix code.
- Full backend regression (`go build`, `go vet`, `go test ./... -race -count=1`) remains green.

## 12. Status (at discovery)

STOPPED FOR REVIEW at discovery time. Approved for implementation; see §13.

## 13. Implementation Record

### 13.1 Decision

Candidate 1 from §9 (delete the log line) was implemented exactly as recommended — the smallest possible change. No token generation, hashing, expiration, storage, or API-contract behavior was touched. No new logging framework or redesign was introduced.

### 13.2 Exact file/function changed

`internal/api/rest/auth.go`, `AuthHandler.ForgotPassword` only. The single line:

```go
log.Printf("[password-reset] Token for user %s: %s (expires in 1 hour)", user.Username, tokenPlaintext)
```

was deleted and replaced with a comment explaining why (referencing this document), directly above the pre-existing, unmodified `h.logAuthEvent(ctx, "password_reset_requested", ...)` call, which already correctly carries no token material (confirmed by reading its call signature and the `logAuthEvent` function body — the `details` parameter is passed as `""`).

### 13.3 Root cause confirmation

Confirmed exactly as investigated: a `log.Printf` placeholder for an unimplemented email-delivery feature, self-acknowledged in the original comment (`// in production, never log tokens`), with no environment/build-tag gate preventing it from running in a real deployment. No additional exposure path existed — a repository-wide grep for `tokenPlaintext`, `resetToken`, `reset_token`, `resetURL`, `reset_url` across `internal/` confirmed the token is only ever (a) generated in-memory, (b) hashed and persisted (`token_hash` column only, in both the SQLite and PostgreSQL repository implementations), and (c) was logged at exactly the one now-removed call site. `ResetPassword` (the token-consuming endpoint) was also read in full and contains no logging of `req.Token` anywhere, including its error paths. No reset URL is constructed anywhere in the codebase (email delivery does not exist yet), so the "secret derivative" risk (`token=...` query strings, `/reset/<token>` URLs) does not apply to the current implementation.

### 13.4 Before evidence (PRE-FIX: FAIL)

The primary regression test (`TestAuthHandler_ForgotPassword_DoesNotLogToken`) was run against the original vulnerable code (temporarily restored, then reverted back to the fix — repository never left in the vulnerable state):

```
captured log output contains the plaintext reset token (or a value matching its hash) — token leaked:
2026/10/03 08:04:35 [password-reset] Token for user valid03user: 30e418b5-db89-42f1-b324-e797de3ae1720c2f7ccb-33bd-48e8-9ddb-4c3cb9606878 (expires in 1 hour)
2026/10/03 08:04:35 [auth] password_reset_requested: user=valid03user ip=127.0.0.1
--- FAIL: TestAuthHandler_ForgotPassword_DoesNotLogToken (1.86s)
```

The test correctly surfaced the actual leaked token value in its own failure output, proving it detects the real vulnerability (via bcrypt-verifying each captured log word against the token's real stored hash) rather than matching a specific string pattern or log format.

### 13.5 Regression tests added

All in new file `internal/api/rest/auth_password_reset_test.go`:

1. **`TestAuthHandler_ForgotPassword_DoesNotLogToken`** — the primary security test. Captures all `log` package output during a real `ForgotPassword` call (with `AuthMode: "jwt"`, i.e. the production-relevant authenticated configuration — not the default `disabled`, which would make the test meaningless since `ForgotPassword` short-circuits before reaching the vulnerable code path). Fetches the real stored `token_hash` for the created row, then checks every space-delimited word in the captured log output against that hash via `auth.CheckPassword` — a genuinely non-vacuous check that would catch the token leaking in any format, any log line, not just the original exact message.
2. **`TestAuthHandler_ResetPassword_TokenRemainsUsable`** — proves the legitimate reset flow (hash, store, hash-based lookup, consume, password actually updated) is unbroken. Since the fix's entire purpose is that no test (or anything else) can read the plaintext token `ForgotPassword` generates, this test independently exercises the same generate/hash/store/consume mechanism `ForgotPassword` and `ResetPassword` both rely on, with a token the test itself controls — proving the underlying mechanism, not just today's specific call, remains correct.
3. **`TestAuthHandler_ForgotPassword_UnknownUser_NoTokenCreatedOrLogged`** — the anti-enumeration path (unknown username, still 200) creates no token and logs nothing password-reset-related. Also documents, in its own comment, that `ForgotPassword`'s only failure branches (hash error, DB write error) are nested inside `if err == nil` checks that skip both the (now-removed) log line and the audit-event call entirely — confirmed by reading the code, not assumed — so no separate failure-path leak scenario exists in the current implementation to test.

A local test-only helper, `setupTestRepoForPasswordReset`, extends the existing shared `setupTestRepoForAuth` helper's minimal hand-rolled schema with the `password_reset_tokens` table (mirroring `migrations/016_password_reset_tokens.sql`), which that shared helper did not previously create. Added locally in the new test file rather than widening the shared helper, since several other existing test files use it unchanged.

### 13.6 After evidence (POST-FIX: PASS)

```
--- PASS: TestAuthHandler_ForgotPassword_DoesNotLogToken (16.95s)
--- PASS: TestAuthHandler_ResetPassword_TokenRemainsUsable (10.57s)
--- PASS: TestAuthHandler_ForgotPassword_UnknownUser_NoTokenCreatedOrLogged (0.01s)
PASS
```

Re-run with `-race`: identical result, all 3 pass.

### 13.7 Secret-leak verification

- Repository-wide grep (§13.3) confirms zero remaining logging paths for the plaintext token, in `ForgotPassword`, `ResetPassword`, or anywhere else in `internal/`.
- No reset URL is ever constructed (email delivery unimplemented), so no `token=`/`/reset/<token>`-style derivative-leak path exists to close.
- The legitimate audit-log call (`logAuthEvent`, both in `ForgotPassword` and `ResetPassword`) was confirmed, by reading its signature and body, to carry only username/IP/user-agent/risk-score metadata — never token material — and was not modified.

### 13.8 Build/vet/race results

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./... -race -count=1` — **all packages pass**, zero failures, zero races, full repository (fresh run after the fix).

### 13.9 Existing regression status

Frontend was not touched by this fix (confirmed via `git status` — only `internal/api/rest/auth.go` and the new test file changed). No frontend re-run was performed or needed for this finding; the frontend's existing, separately-tracked regression status (920 passed / 3 known pre-existing failures) is unaffected and unchanged.

### 13.10 Remaining risks

- Password-reset email delivery remains unimplemented. Until it is, there is **no production mechanism for a user to actually receive their reset token** — the fix correctly closes the leak, but does not address the underlying missing feature. This is explicitly out of scope for VALID-03 (candidate 3 in the original investigation, noted as a separate, larger unit of work) and was not implemented.
- No other credential-logging audit was performed beyond the password-reset flow itself, per the explicit instruction to keep this fix narrowly scoped and not expand into a general security audit.

### 13.11 VALID-03 acceptance status

All criteria from the original investigation's §11 and this implementation's acceptance rules are met: the plaintext token is never logged on any path (success, error, or failure); the legitimate reset flow is unchanged and proven functional; a test was proven to fail against the pre-fix code and pass after the fix; full backend regression is green under `-race`.

**VALID-03 — FIXED**
