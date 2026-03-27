import { useNavigate } from 'react-router-dom';
import { Database, HardDrive, Server, Expand, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
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

interface K8sPVC extends KubernetesResource {
  spec?: {
    volumeName?: string;
    storageClassName?: string;
    accessModes?: string[];
    volumeMode?: string;
    resources?: { requests?: { storage?: string } };
  };
  status?: {
    phase?: string;
    capacity?: { storage?: string };
    accessModes?: string[];
  };
}

function OverviewTab({ resource: pvc, age }: ResourceContext<K8sPVC>) {
  const navigate = useNavigate();
  const capacity = pvc?.status?.capacity?.storage ?? pvc?.spec?.resources?.requests?.storage ?? '—';
  const accessModes = pvc?.spec?.accessModes ?? [];
  const storageClass = pvc?.spec?.storageClassName ?? '—';
  const volumeMode = pvc?.spec?.volumeMode ?? 'Filesystem';
  const volumeName = pvc?.spec?.volumeName ?? '—';
  const labels = pvc?.metadata?.labels ?? {};

  return (
    <div className="space-y-6">
      <SectionCard icon={Database} title="PVC information" tooltip={<p className="text-xs text-muted-foreground">Capacity, storage class, and access</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Status" value={<Badge variant="outline">{pvc?.status?.phase ?? '—'}</Badge>} />
          <DetailRow label="Capacity" value={<Badge variant="secondary" className="font-mono">{capacity}</Badge>} />
          <DetailRow label="Volume Mode" value={volumeMode} />
          <DetailRow label="Storage Class" value={<Badge variant="outline">{storageClass}</Badge>} />
          <DetailRow label="Access Modes" value={<span className="font-mono">{accessModes.join(', ') || '—'}</span>} />
          <DetailRow label="Age" value={age} />
          {volumeName !== '—' && (
            <DetailRow
              label="Bound Volume"
              value={
                <Button
                  variant="link"
                  className="h-auto p-0 font-mono text-left break-all"
                  onClick={() => navigate(`/persistentvolumes/${volumeName}`)}
                >
                  {volumeName}
                </Button>
              }
            />
          )}
        </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={labels} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={pvc?.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

export default function PersistentVolumeClaimDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sPVC>
      resourceType="persistentvolumeclaims"
      kind="PersistentVolumeClaim"
      pluralLabel="Persistent Volume Claims"
      listPath="/persistentvolumeclaims"
      resourceIcon={Database}
      loadingCardCount={5}
      customTabs={customTabs}
      deriveStatus={(pvc) => (pvc?.status?.phase ?? 'Unknown') as ResourceStatus}
      extraHeaderActions={() => [
        { label: 'Expand', icon: Expand, variant: 'outline', onClick: () => toast.info('Expand requires backend support'), className: 'press-effect' },
      ]}
      extraActionItems={() => [
        { icon: Expand, label: 'Expand Volume', description: 'Increase the storage capacity', onClick: () => toast.info('Expand requires backend support'), className: 'press-effect' },
      ]}
      buildStatusCards={(ctx) => {
        const pvc = ctx.resource;
        const requestedCapacity = pvc?.spec?.resources?.requests?.storage ?? '—';
        const usedCapacity = pvc?.status?.capacity?.storage ?? '—';
        const volumeName = pvc?.spec?.volumeName ?? '—';

        return [
          { label: 'Status', value: pvc?.status?.phase ?? '—', icon: Database, iconColor: 'primary' as const },
          { label: 'Capacity', value: requestedCapacity, icon: HardDrive, iconColor: 'info' as const },
          { label: 'Used', value: usedCapacity, icon: HardDrive, iconColor: 'muted' as const },
          { label: 'Volume', value: volumeName, icon: Server, iconColor: 'muted' as const },
          { label: 'Used By', value: '—', icon: Database, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
