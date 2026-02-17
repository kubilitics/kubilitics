/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Kubilitics backend base URL (e.g. http://localhost:8080). Used when frontend talks to backend. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
