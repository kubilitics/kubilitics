# Kubilitics Frontend

Kubernetes dashboard and cluster management UI.

## Development

**Requirements:** Node.js & npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating))

```sh
npm install
npm run dev
```

## Tech stack

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Build

```sh
npm run build
```

## Test

```sh
npm run test
npm run e2e
```

### Live Pod Terminal E2E (real backend/cluster)

Run the live integration spec only when you have a reachable backend and a known pod:

```sh
PLAYWRIGHT_CLUSTER_ID="<cluster-id>" \
PLAYWRIGHT_POD_NAMESPACE="<namespace>" \
PLAYWRIGHT_POD_NAME="<pod-name>" \
PLAYWRIGHT_BACKEND_BASE_URL="http://localhost:8080" \
npx playwright test e2e/pod-terminal-live-backend.spec.ts --config=playwright.config.mjs
```

Optional cluster-shell checks (`kcli`/`kubectl` source switching):

```sh
PLAYWRIGHT_TEST_CLUSTER_SHELL=1 \
PLAYWRIGHT_CLUSTER_ID="<cluster-id>" \
PLAYWRIGHT_POD_NAMESPACE="<namespace>" \
PLAYWRIGHT_POD_NAME="<pod-name>" \
PLAYWRIGHT_BACKEND_BASE_URL="http://localhost:8080" \
npx playwright test e2e/pod-terminal-live-backend.spec.ts --config=playwright.config.mjs
```
