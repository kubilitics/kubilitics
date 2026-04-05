import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';

/** Get the backend base URL for direct fetch calls (non-hook context). */
export function getBackendBase(): string {
  const stored = useBackendConfigStore.getState().backendBaseUrl;
  return getEffectiveBackendBaseUrl(stored);
}
