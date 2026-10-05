/**
 * TOPOLOGY-1 (docs/PRODUCTION-RELIABILITY-AUDIT.md): the namespace selector
 * was cosmetic — selectedNamespaces was only ever applied as a client-side
 * filter after an unscoped, full-cluster backend fetch. These tests prove
 * the selected namespace now reaches the actual backend request for the
 * single-namespace case (the common, default case), while documenting the
 * explicit, deliberate scope boundary for the 0/multi-namespace cases.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTopologyData } from './useTopologyData';
import * as backendApiClient from '@/services/backendApiClient';
import { useBackendConfigStore } from '@/stores/backendConfigStore';

vi.mock('@/services/backendApiClient', () => ({
  getTopology: vi.fn(),
  listResources: vi.fn(),
}));

function emptyGraph(nodes: Array<{ id: string; kind: string; namespace?: string }> = []) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, namespace: n.namespace, name: n.id })),
    edges: [],
  };
}

function namespaceList(names: string[]) {
  return {
    items: names.map((n) => ({ metadata: { name: n }, kind: 'Namespace' })),
    metadata: {},
  };
}

describe('useTopologyData — namespace scoping (TOPOLOGY-1)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.clearAllMocks();
    useBackendConfigStore.setState({ backendBaseUrl: 'http://localhost:8190' });
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(emptyGraph());
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockResolvedValue(namespaceList(['default']));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useBackendConfigStore.setState({ backendBaseUrl: '' });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('a single selected namespace reaches the backend request (the core fix)', async () => {
    renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'namespace',
          selectedNamespaces: new Set(['team-a']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalled();
    });

    const [, , params] = (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.namespace).toBe('team-a');
  });

  it('zero selected namespaces (All Namespaces) fetches unscoped — unchanged, intentional', async () => {
    renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'namespace',
          selectedNamespaces: new Set(),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalled();
    });

    const [, , params] = (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.namespace).toBeUndefined();
  });

  it('multiple selected namespaces fetch unscoped — documented scope boundary (backend has no multi-namespace filter)', async () => {
    renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'namespace',
          selectedNamespaces: new Set(['team-a', 'team-b']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalled();
    });

    const [, , params] = (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.namespace).toBeUndefined();
  });

  it('cluster view mode never scopes by namespace, even with one selected (cluster-scoped resources would be excluded)', async () => {
    renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'cluster',
          selectedNamespaces: new Set(['team-a']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalled();
    });

    const [, , params] = (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.namespace).toBeUndefined();
  });

  it('rbac view mode never scopes by namespace, even with one selected', async () => {
    renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'rbac',
          selectedNamespaces: new Set(['team-a']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalled();
    });

    const [, , params] = (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.namespace).toBeUndefined();
  });

  it('traffic view mode scopes by a single selected namespace', async () => {
    renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'traffic',
          selectedNamespaces: new Set(['team-a']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalled();
    });

    const [, , params] = (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.namespace).toBe('team-a');
  });

  it('switching the selected namespace issues a new backend request scoped to the new namespace (stale-request protection via React Query query-key identity)', async () => {
    const { rerender } = renderHook(
      ({ ns }: { ns: string }) =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'namespace',
          selectedNamespaces: new Set([ns]),
        }),
      { wrapper, initialProps: { ns: 'team-a' } }
    );

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalledTimes(1);
    });
    expect((backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[0][2].namespace).toBe('team-a');

    rerender({ ns: 'team-b' });

    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalledTimes(2);
    });
    expect((backendApiClient.getTopology as ReturnType<typeof vi.fn>).mock.calls[1][2].namespace).toBe('team-b');
  });

  it('still applies client-side namespace filtering as a defense-in-depth layer even when backend-scoped (a backend bug returning extra namespaces must not leak into the displayed graph)', async () => {
    // Simulates a backend that (incorrectly) returns resources from a
    // namespace other than the one requested — proves the existing
    // client-side filterByNamespaces layer still catches it.
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyGraph([
        { id: 'pod-a', kind: 'Pod', namespace: 'team-a' },
        { id: 'pod-b', kind: 'Pod', namespace: 'team-b' }, // should be filtered out
      ])
    );

    const { result } = renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'namespace',
          selectedNamespaces: new Set(['team-a']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.topology?.nodes?.length).toBeGreaterThan(0);
    });

    const ids = result.current.topology?.nodes?.map((n) => n.id) ?? [];
    expect(ids).toContain('pod-a');
    expect(ids).not.toContain('pod-b');
  });
});

describe('useTopologyData — namespace discovery (VALID-06, docs/VALID-06-INVESTIGATION.md)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.clearAllMocks();
    useBackendConfigStore.setState({ backendBaseUrl: 'http://localhost:8190' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useBackendConfigStore.setState({ backendBaseUrl: '' });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('allNamespaces reflects the independent namespace list, NOT the currently loaded (already namespace-scoped) topology graph — the core bug', async () => {
    // The topology graph is scoped to "team-a" only (as it always is for a
    // single selected namespace) and contains no reference to "team-b" or
    // "empty-ns" at all. Before the fix, allNamespaces was derived from
    // these graph nodes, so team-b/empty-ns could never appear.
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyGraph([{ id: 'pod-a', kind: 'Pod', namespace: 'team-a' }])
    );
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockResolvedValue(
      namespaceList(['team-a', 'team-b', 'empty-ns'])
    );

    const { result } = renderHook(
      () =>
        useTopologyData({
          clusterId: 'cluster-1',
          viewMode: 'namespace',
          selectedNamespaces: new Set(['team-a']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.allNamespaces).toEqual(['empty-ns', 'team-a', 'team-b']);
    });
    // Proves it's a real, separate request — not derived from the topology response.
    expect(backendApiClient.listResources).toHaveBeenCalledWith(
      expect.any(String),
      'cluster-1',
      'namespaces',
      expect.anything()
    );
  });

  it('a namespace with zero resources (never appears as a node anywhere) still appears in allNamespaces', async () => {
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(emptyGraph());
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockResolvedValue(
      namespaceList(['default', 'truly-empty-ns'])
    );

    const { result } = renderHook(
      () => useTopologyData({ clusterId: 'cluster-1', viewMode: 'namespace', selectedNamespaces: new Set(['default']) }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.allNamespaces).toContain('truly-empty-ns');
    });
  });

  it('allNamespaces ordering is deterministic (sorted) regardless of backend response order', async () => {
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(emptyGraph());
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockResolvedValue(
      namespaceList(['zeta', 'alpha', 'mu'])
    );

    const { result } = renderHook(
      () => useTopologyData({ clusterId: 'cluster-1', viewMode: 'namespace', selectedNamespaces: new Set() }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.allNamespaces).toEqual(['alpha', 'mu', 'zeta']);
    });
  });

  it('switching the selected namespace does NOT trigger a new namespace-list request — the list is independent of selection', async () => {
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(emptyGraph());
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockResolvedValue(
      namespaceList(['team-a', 'team-b'])
    );

    const { rerender } = renderHook(
      ({ ns }: { ns: string }) =>
        useTopologyData({ clusterId: 'cluster-1', viewMode: 'namespace', selectedNamespaces: new Set([ns]) }),
      { wrapper, initialProps: { ns: 'team-a' } }
    );

    await waitFor(() => {
      expect(backendApiClient.listResources).toHaveBeenCalledTimes(1);
    });

    rerender({ ns: 'team-b' });
    await waitFor(() => {
      expect(backendApiClient.getTopology).toHaveBeenCalledTimes(2); // topology DOES refetch per-namespace
    });
    // but the independent namespace list must not have refetched again
    expect(backendApiClient.listResources).toHaveBeenCalledTimes(1);
  });

  it('namespace enumeration failure surfaces via allNamespacesError, without breaking the (independent) topology fetch', async () => {
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyGraph([{ id: 'pod-a', kind: 'Pod', namespace: 'default' }])
    );
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(
      () => useTopologyData({ clusterId: 'cluster-1', viewMode: 'namespace', selectedNamespaces: new Set(['default']) }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.allNamespacesError).toBe(true);
    });
    // Topology itself must still succeed — these are independent failure domains.
    await waitFor(() => {
      expect(result.current.topology?.nodes?.length).toBeGreaterThan(0);
    });
    expect(result.current.allNamespaces).toEqual([]);
  });

  it('switching clusters re-fetches the namespace list for the new cluster — no state leakage between clusters', async () => {
    (backendApiClient.getTopology as ReturnType<typeof vi.fn>).mockResolvedValue(emptyGraph());
    (backendApiClient.listResources as ReturnType<typeof vi.fn>).mockImplementation(
      async (_baseUrl: string, clusterId: string) =>
        clusterId === 'cluster-1' ? namespaceList(['team-a']) : namespaceList(['other-ns'])
    );

    const { result, rerender } = renderHook(
      ({ clusterId }: { clusterId: string }) =>
        useTopologyData({ clusterId, viewMode: 'namespace', selectedNamespaces: new Set() }),
      { wrapper, initialProps: { clusterId: 'cluster-1' } }
    );

    await waitFor(() => {
      expect(result.current.allNamespaces).toEqual(['team-a']);
    });

    rerender({ clusterId: 'cluster-2' });

    await waitFor(() => {
      expect(result.current.allNamespaces).toEqual(['other-ns']);
    });
    expect(result.current.allNamespaces).not.toContain('team-a');
  });
});
