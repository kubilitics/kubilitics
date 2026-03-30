import { Network, Clock, Info } from 'lucide-react';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
} from '@/components/resources';
import { type KubernetesResource } from '@/hooks/useKubernetes';

interface K8sIPAddressPool extends KubernetesResource {
  spec?: { addresses?: string[]; autoAssign?: boolean };
  status?: { assignedIPv4?: number; assignedIPv6?: number; availableIPv4?: number; availableIPv6?: number };
}

function OverviewTab({ resource: pool, age }: ResourceContext<K8sIPAddressPool>) {
  const addrs = pool?.spec?.addresses ?? [];
  const a4 = pool?.status?.assignedIPv4 ?? 0;
  const a6 = pool?.status?.assignedIPv6 ?? 0;
  const v4 = pool?.status?.availableIPv4 ?? 0;
  const v6 = pool?.status?.availableIPv6 ?? 0;

  return (
    <div className="space-y-6">
      <SectionCard icon={Network} title="IP Address Pool" tooltip={<p className="text-xs text-muted-foreground">MetalLB IP ranges</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Addresses" value={<div className="font-mono text-xs space-y-1">{addrs.length ? addrs.map((a, i) => <div key={i}>{a}</div>) : '—'}</div>} />
          <DetailRow label="Auto Assign" value={pool?.spec?.autoAssign !== false ? 'Yes' : 'No'} />
          <DetailRow label="Assigned IPv4" value={a4} />
          <DetailRow label="Assigned IPv6" value={a6} />
          <DetailRow label="Available IPv4" value={v4} />
          <DetailRow label="Available IPv6" value={v6} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={pool?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={pool?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function IPAddressPoolDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sIPAddressPool>
      resourceType="ipaddresspools"
      kind="IPAddressPool"
      pluralLabel="IP Address Pools"
      listPath="/ipaddresspools"
      resourceIcon={Network}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const pool = ctx.resource;
        const addrs = pool?.spec?.addresses ?? [];
        const a4 = pool?.status?.assignedIPv4 ?? 0;
        const a6 = pool?.status?.assignedIPv6 ?? 0;
        const v4 = pool?.status?.availableIPv4 ?? 0;
        const v6 = pool?.status?.availableIPv6 ?? 0;

        return [
          { label: 'Addresses', value: addrs.length ? addrs.join(', ') : '—', icon: Network, iconColor: 'primary' as const },
          { label: 'Assigned', value: `${a4 + a6}`, icon: Network, iconColor: 'info' as const },
          { label: 'Available', value: `${v4 + v6}`, icon: Network, iconColor: 'muted' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
