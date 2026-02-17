// Unit test for backend config store (B4.3 critical path).
import { describe, it, expect, beforeEach } from 'vitest';
import { useBackendConfigStore } from './backendConfigStore';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';

describe('backendConfigStore', () => {
  beforeEach(() => {
    useBackendConfigStore.getState().setBackendBaseUrl('');
    useBackendConfigStore.getState().setCurrentClusterId(null);
  });

  it('isBackendConfigured returns false when URL is empty', () => {
    useBackendConfigStore.getState().setBackendBaseUrl('');
    expect(useBackendConfigStore.getState().isBackendConfigured()).toBe(false);
  });

  it('isBackendConfigured returns true when URL is set', () => {
    useBackendConfigStore.getState().setBackendBaseUrl(DEFAULT_BACKEND_BASE_URL);
    expect(useBackendConfigStore.getState().isBackendConfigured()).toBe(true);
  });

  it('setBackendBaseUrl trims and strips trailing slashes', () => {
    useBackendConfigStore.getState().setBackendBaseUrl(`  ${DEFAULT_BACKEND_BASE_URL}/  `);
    expect(useBackendConfigStore.getState().backendBaseUrl).toBe(DEFAULT_BACKEND_BASE_URL);
  });

  it('setCurrentClusterId updates cluster id', () => {
    useBackendConfigStore.getState().setCurrentClusterId('cluster-1');
    expect(useBackendConfigStore.getState().currentClusterId).toBe('cluster-1');
  });
});
