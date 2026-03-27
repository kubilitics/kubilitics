import { Activity, Clock, User, Timer, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
  type ResourceStatus,
} from '@/components/resources';
import { type KubernetesResource } from '@/hooks/useKubernetes';

interface LeaseResource extends KubernetesResource {
  spec?: {
    holderIdentity?: string;
    leaseDurationSeconds?: number;
    acquireTime?: string;
    renewTime?: string;
    leaseTransitions?: number;
  };
}

function OverviewTab({ resource: lease, age }: ResourceContext<LeaseResource>) {
  const holderIdentity = lease?.spec?.holderIdentity ?? '–';
  const leaseDurationSeconds = lease?.spec?.leaseDurationSeconds ?? 0;
  const acquireTime = lease?.spec?.acquireTime;
  const renewTime = lease?.spec?.renewTime;
  const leaseTransitions = lease?.spec?.leaseTransitions ?? 0;

  const renewTimeDate = renewTime ? new Date(renewTime) : null;
  const now = Date.now();
  const secondsSinceRenewal = renewTimeDate ? Math.floor((now - renewTimeDate.getTime()) / 1000) : 0;
  const isExpired = leaseDurationSeconds > 0 && secondsSinceRenewal > leaseDurationSeconds;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Activity} title="Lease Info" tooltip="Holder, duration, transitions">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Holder Identity" value={<span className="font-mono break-all">{holderIdentity}</span>} />
          <DetailRow label="Lease Duration" value={<Badge variant="secondary">{leaseDurationSeconds ? `${leaseDurationSeconds}s` : '–'}</Badge>} />
          <DetailRow label="Transitions" value={String(leaseTransitions)} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      <SectionCard icon={Clock} title="Timing" tooltip="Acquire and renew timestamps">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Acquire Time" value={<span className="font-mono">{acquireTime ? new Date(acquireTime).toLocaleString() : '–'}</span>} />
          <DetailRow label="Renew Time" value={<span className="font-mono">{renewTime ? new Date(renewTime).toLocaleString() : '–'}</span>} />
          <DetailRow label="Status" value={<Badge variant={isExpired ? 'destructive' : 'default'}>{isExpired ? 'Expired' : 'Active'}</Badge>} />
        </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={lease?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={lease?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
];

export default function LeaseDetail() {
  return (
    <GenericResourceDetail<LeaseResource>
      resourceType="leases"
      kind="Lease"
      pluralLabel="Leases"
      listPath="/leases"
      resourceIcon={Activity}
      customTabs={customTabs}
      deriveStatus={(lease: LeaseResource): ResourceStatus => {
        const leaseDurationSeconds = lease?.spec?.leaseDurationSeconds ?? 0;
        const renewTime = lease?.spec?.renewTime;
        const renewTimeDate = renewTime ? new Date(renewTime) : null;
        const now = Date.now();
        const secondsSinceRenewal = renewTimeDate ? Math.floor((now - renewTimeDate.getTime()) / 1000) : 0;
        const isExpired = leaseDurationSeconds > 0 && secondsSinceRenewal > leaseDurationSeconds;
        return isExpired ? 'Failed' : 'Healthy';
      }}
      buildStatusCards={(ctx) => {
        const lease = ctx.resource;
        const holderIdentity = lease?.spec?.holderIdentity ?? '–';
        const leaseDurationSeconds = lease?.spec?.leaseDurationSeconds ?? 0;
        const renewTime = lease?.spec?.renewTime;
        const held = !!lease?.spec?.holderIdentity;

        const renewTimeDate = renewTime ? new Date(renewTime) : null;
        const now = Date.now();
        const secondsSinceRenewal = renewTimeDate ? Math.floor((now - renewTimeDate.getTime()) / 1000) : 0;
        const isExpired = leaseDurationSeconds > 0 && secondsSinceRenewal > leaseDurationSeconds;

        return [
          { label: 'Holder', value: holderIdentity !== '–' ? holderIdentity : '–', icon: User, iconColor: 'info' as const },
          { label: 'Duration', value: leaseDurationSeconds ? `${leaseDurationSeconds}s` : '–', icon: Timer, iconColor: 'primary' as const },
          { label: 'Last Renewed', value: renewTime ? new Date(renewTime).toISOString() : '–', icon: Clock, iconColor: 'muted' as const },
          { label: 'Status', value: isExpired ? 'Expired' : held ? 'Held' : 'Available', icon: Activity, iconColor: (isExpired ? 'error' : 'success') as 'error' | 'success' },
        ];
      }}
    />
  );
}
