# Kubilitics — Enterprise-grade one-command dev and test (B3)
# Usage: make dev | test | backend | frontend | clean

.PHONY: dev test backend frontend kcli backend-test frontend-test kcli-test test-reports clean env-example restart

# Default: run full stack (backend + frontend) via script
dev: env-example
	@chmod +x scripts/dev.sh 2>/dev/null || true
	@./scripts/dev.sh

# Build backend, then kill processes on 8080/5173 and start backend + frontend.
restart:
	@chmod +x scripts/restart.sh 2>/dev/null || true
	@./scripts/restart.sh

# Or run in separate terminals: make backend-dev | make frontend-dev

# Run backend only (blocking). Use binary if built, else go run. Must run from backend dir so migrations/db are found.
backend-dev:
	cd kubilitics-backend && (test -x bin/kubilitics-backend && ./bin/kubilitics-backend || go run ./cmd/server)

# Run frontend only (blocking)
frontend-dev:
	cd kubilitics-frontend && npm run dev

# Build backend binary
backend:
	cd kubilitics-backend && go build -o bin/kubilitics-backend ./cmd/server

# Build kcli binary
kcli:
	cd kcli && go build -o bin/kcli ./cmd/kcli

# Build frontend (production)
frontend:
	cd kubilitics-frontend && npm run build

# Run all tests and publish to test_reports (B3.3)
test: test-reports
	@mkdir -p test_reports/backend test_reports/frontend test_reports/playwright
	$(MAKE) backend-test 2>&1 | tee test_reports/backend/test.log; exit $${PIPESTATUS[0]}
	$(MAKE) frontend-test 2>&1 | tee test_reports/frontend/test.log; exit $${PIPESTATUS[0]}
	$(MAKE) kcli-test 2>&1 | tee test_reports/backend/kcli-test.log; exit $${PIPESTATUS[0]}
	@echo "Test reports: test_reports/"

# Run backend + frontend tests + E2E (full local verification before push)
test-all: test
	$(MAKE) e2e

backend-test:
	cd kubilitics-backend && go test -v -count=1 ./... 2>&1

frontend-test:
	cd kubilitics-frontend && npm run test 2>&1

kcli-test:
	cd kcli && go test -v -count=1 ./... 2>&1

# E2E (optional; requires backend + frontend running or playwright config). Use CI=true to auto-start preview server.
e2e:
	@mkdir -p test_reports/playwright
	cd kubilitics-frontend && CI=true npx playwright test --reporter=html 2>&1 | tee ../test_reports/playwright/e2e.log

# Ensure test_reports dir exists (B3.3)
test-reports:
	@mkdir -p test_reports/backend test_reports/frontend test_reports/playwright
	@touch test_reports/backend/.gitkeep test_reports/frontend/.gitkeep test_reports/playwright/.gitkeep

# Copy .env.example to .env if missing (B3.2)
env-example:
	@if [ ! -f .env ]; then cp -n .env.example .env 2>/dev/null || true; echo "Created .env from .env.example (if present)"; fi

clean:
	rm -rf kubilitics-backend/bin
	rm -rf kubilitics-frontend/dist
	rm -rf test_reports/backend/*.log test_reports/frontend/*.log test_reports/playwright/*.log 2>/dev/null || true
