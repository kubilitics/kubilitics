# Test Fixtures (B4.5)

Fixtures for integration and E2E tests. No production data.

- **clusters-list.json** — Sample GET `/api/v1/clusters` response (one cluster).
- **topology-response.json** — Sample GET `/api/v1/clusters/{clusterId}/topology` response (minimal graph).

Usage: load in integration tests or Playwright to assert API contract and UI behavior.
