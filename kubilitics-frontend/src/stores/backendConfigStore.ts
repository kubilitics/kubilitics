/**
 * Backend config store: Kubilitics backend base URL and current cluster ID.
 * Used when frontend talks to Kubilitics backend (GET clusters, GET topology, etc.).
 * Per TASKS A3.1: store for backend URL and current cluster ID.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_BACKEND_BASE_URL, isLocalHostname } from '@/lib/backendConstants';

/** C4.5: When running inside Tauri desktop, default to sidecar (same port as backend). */
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return !!(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

/** Default backend URL: desktop sidecar or local host (dev) so users never need to "set backend" like Lens/Headlamp. */
export function getDefaultBackendBaseUrl(): string {
  if (isTauri()) {
    return DEFAULT_BACKEND_BASE_URL;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    const url = String(import.meta.env.VITE_API_URL).trim();
    if (url) return url.replace(/\/+$/, ''); // strip trailing slashes
  }
  // In dev on localhost: use empty base URL so requests go to same origin and Vite proxy forwards to backend (avoids cross-origin WebSocket errors)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return '';
  }
  // Browser on local host (production build): use explicit backend URL
  if (typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return DEFAULT_BACKEND_BASE_URL;
  }
  return '';
}

/** Effective backend URL: in dev on localhost always use proxy (''); otherwise stored or default. */
export function getEffectiveBackendBaseUrl(stored: string): string {
  // In dev on localhost, always use same-origin so Vite proxy is used (avoids WebSocket connection errors)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
    return '';
  }
  const trimmed = (stored || '').trim();
  if (trimmed) return trimmed.replace(/\/+$/, '');
  return getDefaultBackendBaseUrl();
}

export interface BackendConfigState {
  /** Base URL of Kubilitics backend (e.g. http://localhost:8080). Empty = backend not configured. */
  backendBaseUrl: string;
  /** Currently selected cluster ID for backend-scoped requests (e.g. topology, resources). */
  currentClusterId: string | null;
}

interface BackendConfigStore extends BackendConfigState {
  setBackendBaseUrl: (url: string) => void;
  setCurrentClusterId: (clusterId: string | null) => void;
  /** Clear backend URL and cluster; call when switching to direct K8s or disconnecting. */
  clearBackend: () => void;
  /** True when backend mode is configured (non-empty base URL). */
  isBackendConfigured: () => boolean;
}

const initialState: BackendConfigState = {
  backendBaseUrl: getDefaultBackendBaseUrl(),
  currentClusterId: null,
};

export const useBackendConfigStore = create<BackendConfigStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setBackendBaseUrl: (url) =>
        set({
          backendBaseUrl: (url || '').trim().replace(/\/+$/, ''),
        }),

      setCurrentClusterId: (clusterId) =>
        set({ currentClusterId: clusterId ?? null }),

      clearBackend: () =>
        set({
          backendBaseUrl: getDefaultBackendBaseUrl(),
          currentClusterId: null,
        }),

      isBackendConfigured: () => {
        const url = getEffectiveBackendBaseUrl(get().backendBaseUrl);
        // In dev on localhost we use '' (proxy), which is valid
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof window !== 'undefined' && isLocalHostname(window.location?.hostname ?? '')) {
          return true;
        }
        return typeof url === 'string' && url.length > 0;
      },
    }),
    {
      name: 'kubilitics-backend-config',
    }
  )
);
