import { useNavigate } from 'react-router-dom';
import { HardDrive, Database, Server, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

interface K8sPV extends KubernetesResource {
  spec?: {
    capacity?: { storage?: string };
    accessModes?: string[];
    persistentVolumeReclaimPolicy?: string;
    storageClassName?: string;
    volumeMode?: string;
    claimRef?: { namespace?: string; name?: string };
    [key: string]: unknown;
  };
  status?: { phase?: string };
}

function OverviewTab({ resource: pv, age }: ResourceContext<K8sPV>) {
  const navigate = useNavigate();
  const capacity = pv?.spec?.capacity?.storage ?? '—';
  const accessModes = pv?.spec?.accessModes ?? [];
  const reclaimPolicy = pv?.spec?.persistentVolumeReclaimPolicy ?? '—';
  const storageClass = pv?.spec?.storageClassName ?? '—';
  const volumeMode = pv?.spec?.volumeMode ?? 'Filesystem';
  const claimRef = pv?.spec?.claimRef;
  const claimNs = claimRef?.namespace;
  const claimName = claimRef?.name;
  const labels = pv?.metadata?.labels ?? {};

  return (
    <div className="space-y-6">
      <SectionCard icon={HardDrive} title="PV information" tooltip={<p className="text-xs text-muted-foreground">Capacity, access, and storage class</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Capacity" value={<Badge variant="secondary" className="font-mono">{capacity}</Badge>} />
          <DetailRow label="Volume Mode" value={volumeMode} />
          <DetailRow label="Storage Class" value={<Badge variant="outline">{storageClass}</Badge>} />
          <DetailRow label="Reclaim Policy" value={reclaimPolicy} />
          <DetailRow label="Access Modes" value={<span className="font-mono">{accessModes.join(', ') || '—'}</span>} />
          <DetailRow label="Age" value={age} />
          {claimRef && (
            <DetailRow
              label="Bound Claim"
              value={
                <Button
                  variant="link"
                  className="h-auto p-0 font-mono text-left break-all"
                  onClick={() => claimNs && claimName && navigate(`/persistentvolumeclaims/${claimNs}/${claimName}`)}
                >
                  {claimNs}/{claimName}
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
        <AnnotationList annotations={pv?.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

export default function PersistentVolumeDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sPV>
      resourceType="persistentvolumes"
      kind="PersistentVolume"
      pluralLabel="Persistent Volumes"
      listPath="/persistentvolumes"
      resourceIcon={HardDrive}
      loadingCardCount={5}
      customTabs={customTabs}
      deriveStatus={(pv) => (pv?.status?.phase ?? 'Unknown') as ResourceStatus}
      buildStatusCards={(ctx) => {
        const pv = ctx.resource;
        const capacity = pv?.spec?.capacity?.storage ?? '—';
        const accessModes = pv?.spec?.accessModes ?? [];
        const reclaimPolicy = pv?.spec?.persistentVolumeReclaimPolicy ?? '—';
        const claimRef = pv?.spec?.claimRef;
        const claimNs = claimRef?.namespace;
        const claimName = claimRef?.name;

        const accessModesDisplay = accessModes.length
          ? accessModes.map((m: string) => (m === 'ReadWriteOnce' ? 'RWO' : m === 'ReadOnlyMany' ? 'ROX' : m === 'ReadWriteMany' ? 'RWX' : m === 'ReadWriteOncePod' ? 'RWOP' : m)).join(', ')
          : '—';

        return [
          { label: 'Status', value: pv?.status?.phase ?? '—', icon: HardDrive, iconColor: 'primary' as const },
          { label: 'Capacity', value: capacity, icon: Database, iconColor: 'info' as const },
          { label: 'Access Modes', value: accessModesDisplay, icon: Server, iconColor: 'muted' as const },
          { label: 'Reclaim Policy', value: reclaimPolicy, icon: Server, iconColor: 'muted' as const },
          { label: 'Claim', value: claimRef ? `${claimNs}/${claimName}` : '—', icon: HardDrive, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
