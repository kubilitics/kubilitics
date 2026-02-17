import { useK8sResourceList, type KubernetesResource } from './useKubernetes';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { useMemo } from 'react';

// Mock counts for demo mode
const mockCounts: Record<string, number> = {
  pods: 54,
  deployments: 18,
  replicasets: 22,
  statefulsets: 2,
  daemonsets: 3,
  jobs: 1614,
  cronjobs: 8,
  podtemplates: 0,
  controllerrevisions: 0,
  resourceslices: 0,
  deviceclasses: 0,
  ipaddresspools: 0,
  bgppeers: 0,
  services: 15,
  ingresses: 5,
  ingressclasses: 2,
  endpoints: 15,
  endpointslices: 15,
  networkpolicies: 7,
  configmaps: 34,
  secrets: 3,
  persistentvolumes: 3,
  persistentvolumeclaims: 4,
  storageclasses: 2,
  volumeattachments: 3,
  volumesnapshots: 0,
  volumesnapshotclasses: 0,
  volumesnapshotcontents: 0,
  nodes: 3,
  namespaces: 22,
  apiservices: 27,
  leases: 7,
  serviceaccounts: 63,
  roles: 14,
  clusterroles: 70,
  rolebindings: 14,
  clusterrolebindings: 56,
  priorityclasses: 2,
  resourcequotas: 2,
  limitranges: 2,
  horizontalpodautoscalers: 4,
  verticalpodautoscalers: 10,
  poddisruptionbudgets: 2,
  customresourcedefinitions: 7,
  mutatingwebhookconfigurations: 5,
  validatingwebhookconfigurations: 2,
};

export interface ResourceCounts {
  pods: number;
  deployments: number;
  replicasets: number;
  statefulsets: number;
  daemonsets: number;
  jobs: number;
  cronjobs: number;
  podtemplates: number;
  controllerrevisions: number;
  resourceslices: number;
  deviceclasses: number;
  ipaddresspools: number;
  bgppeers: number;
  services: number;
  ingresses: number;
  ingressclasses: number;
  endpoints: number;
  endpointslices: number;
  networkpolicies: number;
  configmaps: number;
  secrets: number;
  persistentvolumes: number;
  persistentvolumeclaims: number;
  storageclasses: number;
  volumeattachments: number;
  volumesnapshots: number;
  volumesnapshotclasses: number;
  volumesnapshotcontents: number;
  nodes: number;
  namespaces: number;
  apiservices: number;
  leases: number;
  serviceaccounts: number;
  roles: number;
  clusterroles: number;
  rolebindings: number;
  clusterrolebindings: number;
  priorityclasses: number;
  resourcequotas: number;
  limitranges: number;
  horizontalpodautoscalers: number;
  verticalpodautoscalers: number;
  poddisruptionbudgets: number;
  customresourcedefinitions: number;
  mutatingwebhookconfigurations: number;
  validatingwebhookconfigurations: number;
}

// Individual resource count hooks
function useResourceCount(resourceType: keyof ResourceCounts) {
  const { isConnected } = useConnectionStatus();
  const { data, isLoading } = useK8sResourceList<KubernetesResource>(
    resourceType as any,
    undefined,
    {
      enabled: isConnected,
      refetchInterval: 60000,
    }
  );

  return {
    count: isConnected ? (data?.items?.length ?? 0) : (mockCounts[resourceType] ?? 0),
    isLoading: isConnected && isLoading,
    isConnected,
  };
}

// Main hook to get all resource counts.
// When backend is configured and activeCluster is set, uses backend list APIs for real counts.
// Otherwise when direct K8s is connected uses list; when neither, returns mock counts.
export function useResourceCounts(): { counts: ResourceCounts; isLoading: boolean; isConnected: boolean } {
  const { isConnected } = useConnectionStatus();

  // Use high limit for sidebar counts so backend returns full count (up to cap) instead of default 10
  const SIDEBAR_COUNT_LIMIT = 5000;
  const pods = useK8sResourceList<KubernetesResource>('pods', undefined, {
    enabled: isConnected,
    refetchInterval: 30000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const deployments = useK8sResourceList<KubernetesResource>('deployments', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const services = useK8sResourceList<KubernetesResource>('services', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const nodes = useK8sResourceList<KubernetesResource>('nodes', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const namespaces = useK8sResourceList<KubernetesResource>('namespaces', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const replicasets = useK8sResourceList<KubernetesResource>('replicasets', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const statefulsets = useK8sResourceList<KubernetesResource>('statefulsets', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const daemonsets = useK8sResourceList<KubernetesResource>('daemonsets', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const jobs = useK8sResourceList<KubernetesResource>('jobs', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const cronjobs = useK8sResourceList<KubernetesResource>('cronjobs', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const podtemplates = useK8sResourceList<KubernetesResource>('podtemplates', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const controllerrevisions = useK8sResourceList<KubernetesResource>('controllerrevisions', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const resourceslices = useK8sResourceList<KubernetesResource>('resourceslices', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const deviceclasses = useK8sResourceList<KubernetesResource>('deviceclasses', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const ipaddresspools = useK8sResourceList<KubernetesResource>('ipaddresspools', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const bgppeers = useK8sResourceList<KubernetesResource>('bgppeers', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const configmaps = useK8sResourceList<KubernetesResource>('configmaps', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const secrets = useK8sResourceList<KubernetesResource>('secrets', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const ingresses = useK8sResourceList<KubernetesResource>('ingresses', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const ingressclasses = useK8sResourceList<KubernetesResource>('ingressclasses', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const endpoints = useK8sResourceList<KubernetesResource>('endpoints', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const endpointslices = useK8sResourceList<KubernetesResource>('endpointslices', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const networkpolicies = useK8sResourceList<KubernetesResource>('networkpolicies', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const persistentvolumes = useK8sResourceList<KubernetesResource>('persistentvolumes', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const persistentvolumeclaims = useK8sResourceList<KubernetesResource>('persistentvolumeclaims', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const storageclasses = useK8sResourceList<KubernetesResource>('storageclasses', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const volumeattachments = useK8sResourceList<KubernetesResource>('volumeattachments', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const volumesnapshots = useK8sResourceList<KubernetesResource>('volumesnapshots', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const volumesnapshotclasses = useK8sResourceList<KubernetesResource>('volumesnapshotclasses', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const volumesnapshotcontents = useK8sResourceList<KubernetesResource>('volumesnapshotcontents', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const apiservices = useK8sResourceList<KubernetesResource>('apiservices', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const leases = useK8sResourceList<KubernetesResource>('leases', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const serviceaccounts = useK8sResourceList<KubernetesResource>('serviceaccounts', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const roles = useK8sResourceList<KubernetesResource>('roles', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const clusterroles = useK8sResourceList<KubernetesResource>('clusterroles', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const rolebindings = useK8sResourceList<KubernetesResource>('rolebindings', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const clusterrolebindings = useK8sResourceList<KubernetesResource>('clusterrolebindings', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const priorityclasses = useK8sResourceList<KubernetesResource>('priorityclasses', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const resourcequotas = useK8sResourceList<KubernetesResource>('resourcequotas', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const limitranges = useK8sResourceList<KubernetesResource>('limitranges', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const horizontalpodautoscalers = useK8sResourceList<KubernetesResource>('horizontalpodautoscalers', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const verticalpodautoscalers = useK8sResourceList<KubernetesResource>('verticalpodautoscalers', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const poddisruptionbudgets = useK8sResourceList<KubernetesResource>('poddisruptionbudgets', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const customresourcedefinitions = useK8sResourceList<KubernetesResource>('customresourcedefinitions', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const mutatingwebhookconfigurations = useK8sResourceList<KubernetesResource>('mutatingwebhookconfigurations', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });
  const validatingwebhookconfigurations = useK8sResourceList<KubernetesResource>('validatingwebhookconfigurations', undefined, {
    enabled: isConnected,
    refetchInterval: 60000,
    limit: SIDEBAR_COUNT_LIMIT,
  });

  const counts = useMemo<ResourceCounts>(() => {
    if (!isConnected) {
      return {
        pods: mockCounts.pods,
        deployments: mockCounts.deployments,
        replicasets: mockCounts.replicasets,
        statefulsets: mockCounts.statefulsets,
        daemonsets: mockCounts.daemonsets,
        jobs: mockCounts.jobs,
        cronjobs: mockCounts.cronjobs,
        podtemplates: mockCounts.podtemplates,
        controllerrevisions: mockCounts.controllerrevisions,
        resourceslices: mockCounts.resourceslices,
        deviceclasses: mockCounts.deviceclasses,
        ipaddresspools: mockCounts.ipaddresspools,
        bgppeers: mockCounts.bgppeers,
        services: mockCounts.services,
        ingresses: mockCounts.ingresses,
        ingressclasses: mockCounts.ingressclasses,
        endpoints: mockCounts.endpoints,
        endpointslices: mockCounts.endpointslices,
        networkpolicies: mockCounts.networkpolicies,
        configmaps: mockCounts.configmaps,
        secrets: mockCounts.secrets,
        persistentvolumes: mockCounts.persistentvolumes,
        persistentvolumeclaims: mockCounts.persistentvolumeclaims,
        storageclasses: mockCounts.storageclasses,
        volumeattachments: mockCounts.volumeattachments,
        volumesnapshots: mockCounts.volumesnapshots,
        volumesnapshotclasses: mockCounts.volumesnapshotclasses,
        volumesnapshotcontents: mockCounts.volumesnapshotcontents,
        nodes: mockCounts.nodes,
        namespaces: mockCounts.namespaces,
        apiservices: mockCounts.apiservices,
        leases: mockCounts.leases,
        serviceaccounts: mockCounts.serviceaccounts,
        roles: mockCounts.roles,
        clusterroles: mockCounts.clusterroles,
        rolebindings: mockCounts.rolebindings,
        clusterrolebindings: mockCounts.clusterrolebindings,
        priorityclasses: mockCounts.priorityclasses,
        resourcequotas: mockCounts.resourcequotas,
        limitranges: mockCounts.limitranges,
        horizontalpodautoscalers: mockCounts.horizontalpodautoscalers,
        verticalpodautoscalers: mockCounts.verticalpodautoscalers,
        poddisruptionbudgets: mockCounts.poddisruptionbudgets,
        customresourcedefinitions: mockCounts.customresourcedefinitions,
        mutatingwebhookconfigurations: mockCounts.mutatingwebhookconfigurations,
        validatingwebhookconfigurations: mockCounts.validatingwebhookconfigurations,
      };
    }

    return {
      pods: pods.data?.items?.length ?? 0,
      deployments: deployments.data?.items?.length ?? 0,
      replicasets: replicasets.data?.items?.length ?? 0,
      statefulsets: statefulsets.data?.items?.length ?? 0,
      daemonsets: daemonsets.data?.items?.length ?? 0,
      jobs: jobs.data?.items?.length ?? 0,
      cronjobs: cronjobs.data?.items?.length ?? 0,
      podtemplates: podtemplates.data?.items?.length ?? 0,
      controllerrevisions: controllerrevisions.data?.items?.length ?? 0,
      resourceslices: resourceslices.data?.items?.length ?? 0,
      deviceclasses: deviceclasses.data?.items?.length ?? 0,
      ipaddresspools: ipaddresspools.data?.items?.length ?? 0,
      bgppeers: bgppeers.data?.items?.length ?? 0,
      services: services.data?.items?.length ?? 0,
      ingresses: ingresses.data?.items?.length ?? 0,
      ingressclasses: ingressclasses.data?.items?.length ?? 0,
      endpoints: endpoints.data?.items?.length ?? 0,
      endpointslices: endpointslices.data?.items?.length ?? 0,
      networkpolicies: networkpolicies.data?.items?.length ?? 0,
      configmaps: configmaps.data?.items?.length ?? 0,
      secrets: secrets.data?.items?.length ?? 0,
      persistentvolumes: persistentvolumes.data?.items?.length ?? 0,
      persistentvolumeclaims: persistentvolumeclaims.data?.items?.length ?? 0,
      storageclasses: storageclasses.data?.items?.length ?? 0,
      volumeattachments: volumeattachments.data?.items?.length ?? 0,
      volumesnapshots: volumesnapshots.data?.items?.length ?? 0,
      volumesnapshotclasses: volumesnapshotclasses.data?.items?.length ?? 0,
      volumesnapshotcontents: volumesnapshotcontents.data?.items?.length ?? 0,
      nodes: nodes.data?.items?.length ?? 0,
      namespaces: namespaces.data?.items?.length ?? 0,
      apiservices: apiservices.data?.items?.length ?? 0,
      leases: leases.data?.items?.length ?? 0,
      serviceaccounts: serviceaccounts.data?.items?.length ?? 0,
      roles: roles.data?.items?.length ?? 0,
      clusterroles: clusterroles.data?.items?.length ?? 0,
      rolebindings: rolebindings.data?.items?.length ?? 0,
      clusterrolebindings: clusterrolebindings.data?.items?.length ?? 0,
      priorityclasses: priorityclasses.data?.items?.length ?? 0,
      resourcequotas: resourcequotas.data?.items?.length ?? 0,
      limitranges: limitranges.data?.items?.length ?? 0,
      horizontalpodautoscalers: horizontalpodautoscalers.data?.items?.length ?? 0,
      verticalpodautoscalers: verticalpodautoscalers.data?.items?.length ?? 0,
      poddisruptionbudgets: poddisruptionbudgets.data?.items?.length ?? 0,
      customresourcedefinitions: customresourcedefinitions.data?.items?.length ?? 0,
      mutatingwebhookconfigurations: mutatingwebhookconfigurations.data?.items?.length ?? 0,
      validatingwebhookconfigurations: validatingwebhookconfigurations.data?.items?.length ?? 0,
    };
  }, [
    isConnected,
    pods.data,
    deployments.data,
    replicasets.data,
    statefulsets.data,
    daemonsets.data,
    jobs.data,
    cronjobs.data,
    podtemplates.data,
    controllerrevisions.data,
    resourceslices.data,
    deviceclasses.data,
    ipaddresspools.data,
    bgppeers.data,
    services.data,
    ingresses.data,
    ingressclasses.data,
    endpoints.data,
    endpointslices.data,
    networkpolicies.data,
    nodes.data,
    namespaces.data,
    configmaps.data,
    secrets.data,
    persistentvolumes.data,
    persistentvolumeclaims.data,
    storageclasses.data,
    volumeattachments.data,
    volumesnapshots.data,
    volumesnapshotclasses.data,
    volumesnapshotcontents.data,
    apiservices.data,
    leases.data,
    serviceaccounts.data,
    roles.data,
    clusterroles.data,
    rolebindings.data,
    clusterrolebindings.data,
    priorityclasses.data,
    resourcequotas.data,
    limitranges.data,
    horizontalpodautoscalers.data,
    verticalpodautoscalers.data,
    poddisruptionbudgets.data,
    customresourcedefinitions.data,
    mutatingwebhookconfigurations.data,
    validatingwebhookconfigurations.data,
  ]);

  const isLoading =
    pods.isLoading ||
    deployments.isLoading ||
    replicasets.isLoading ||
    statefulsets.isLoading ||
    daemonsets.isLoading ||
    jobs.isLoading ||
    cronjobs.isLoading ||
    podtemplates.isLoading ||
    controllerrevisions.isLoading ||
    resourceslices.isLoading ||
    deviceclasses.isLoading ||
    ipaddresspools.isLoading ||
    bgppeers.isLoading ||
    services.isLoading ||
    ingresses.isLoading ||
    ingressclasses.isLoading ||
    endpoints.isLoading ||
    endpointslices.isLoading ||
    networkpolicies.isLoading ||
    nodes.isLoading ||
    namespaces.isLoading ||
    configmaps.isLoading ||
    secrets.isLoading ||
    persistentvolumes.isLoading ||
    persistentvolumeclaims.isLoading ||
    storageclasses.isLoading ||
    volumeattachments.isLoading ||
    volumesnapshots.isLoading ||
    volumesnapshotclasses.isLoading ||
    volumesnapshotcontents.isLoading ||
    apiservices.isLoading ||
    leases.isLoading ||
    serviceaccounts.isLoading ||
    roles.isLoading ||
    clusterroles.isLoading ||
    rolebindings.isLoading ||
    clusterrolebindings.isLoading ||
    priorityclasses.isLoading ||
    resourcequotas.isLoading ||
    limitranges.isLoading ||
    horizontalpodautoscalers.isLoading ||
    verticalpodautoscalers.isLoading ||
    poddisruptionbudgets.isLoading ||
    customresourcedefinitions.isLoading ||
    mutatingwebhookconfigurations.isLoading ||
    validatingwebhookconfigurations.isLoading;

  return { counts, isLoading, isConnected };
}

export { useResourceCount };
