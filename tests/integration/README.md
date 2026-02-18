# Integration Tests

This directory contains integration tests that verify the full stack (backend, AI, frontend) works together.

## Running Integration Tests Locally

### Prerequisites

- Docker and Docker Compose installed
- Test kubeconfig (optional, for cluster-related tests)

### Quick Start

```bash
# Start all services
docker-compose -f docker-compose.test.yml --profile with-frontend --profile with-ai up -d

# Wait for services to be ready
docker-compose -f docker-compose.test.yml ps

# Run Playwright tests
cd kubilitics-frontend
export PLAYWRIGHT_BASE_URL=http://localhost:4173
export PLAYWRIGHT_BACKEND_BASE_URL=http://localhost:819
npx playwright test --config=playwright.config.mjs

# Stop services
cd ..
docker-compose -f docker-compose.test.yml down
```

### Test Configurations

#### Backend Only
```bash
docker-compose -f docker-compose.test.yml up -d
```

#### Backend + Frontend
```bash
docker-compose -f docker-compose.test.yml --profile with-frontend up -d
```

#### Full Stack (Backend + AI + Frontend)
```bash
docker-compose -f docker-compose.test.yml --profile with-frontend --profile with-ai up -d
```

## CI/CD

Integration tests run automatically in GitHub Actions via `.github/workflows/integration-test.yml`:
- On every push to main/develop
- On pull requests
- Can be triggered manually via workflow_dispatch

## Test Structure

- `docker-compose.test.yml` - Docker Compose configuration for test environment
- Playwright tests are in `kubilitics-frontend/e2e/`
- Backend API tests can be added to `tests/integration/`

## Troubleshooting

### Services not starting
```bash
# Check logs
docker-compose -f docker-compose.test.yml logs

# Check service status
docker-compose -f docker-compose.test.yml ps
```

### Port conflicts
If ports 819, 8081, or 4173 are already in use, modify `docker-compose.test.yml` to use different ports.

### Frontend not connecting to backend
Ensure the nginx configuration in `kubilitics-frontend/nginx.conf` has the correct backend service name (`backend:819`).
