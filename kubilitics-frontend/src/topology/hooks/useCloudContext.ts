import { useMemo } from 'react';
import { useClusterStore } from '@/stores/clusterStore';
import { getProviderLogo, getProviderLabel } from '@/topology/icons/providerLogoMap';
import { getCloudIcon, type CloudIconMetadata } from '@/topology/icons/cloudIconMap';

export interface CloudContext {
  providerLogo: string | null;
  providerLabel: string;
  cloudIconUrl: string | null;
  provider: string;
}

export function useCloudContext(
  kind: string,
  metadata?: CloudIconMetadata
): CloudContext {
  const activeCluster = useClusterStore((s) => s.activeCluster);
  const provider = activeCluster?.provider ?? 'on-prem';

  return useMemo(() => ({
    providerLogo: getProviderLogo(provider),
    providerLabel: getProviderLabel(provider),
    cloudIconUrl: getCloudIcon(provider, kind, metadata),
    provider,
  }), [provider, kind, metadata]);
}

export function getCloudContext(
  provider: string,
  kind: string,
  metadata?: CloudIconMetadata
): CloudContext {
  return {
    providerLogo: getProviderLogo(provider),
    providerLabel: getProviderLabel(provider),
    cloudIconUrl: getCloudIcon(provider, kind, metadata),
    provider,
  };
}
