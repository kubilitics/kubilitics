import { Layers, Server, Settings, Star, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/components/ui/sonner';

interface K8sStorageClass extends KubernetesResource {
  provisioner?: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
  parameters?: Record<string, string>;
}

function OverviewTab({ resource: sc, age }: ResourceContext<K8sStorageClass>) {
  const provisioner = sc?.provisioner ?? '—';
  const reclaimPolicy = sc?.reclaimPolicy ?? 'Delete';
  const volumeBindingMode = sc?.volumeBindingMode ?? 'Immediate';
  const allowVolumeExpansion = sc?.allowVolumeExpansion ?? false;
  const isDefault = sc?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
  const parameters = sc?.parameters ?? {};

  return (
    <div className="space-y-6">
      <SectionCard icon={Layers} title="Storage Class information" tooltip={<p className="text-xs text-muted-foreground">Provisioner and volume behavior</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Provisioner" value={<span className="font-mono text-xs break-all">{provisioner}</span>} />
          <DetailRow label="Reclaim Policy" value={<Badge variant="outline">{reclaimPolicy}</Badge>} />
          <DetailRow label="Volume Binding" value={volumeBindingMode} />
          <DetailRow label="Volume Expansion" value={<Badge variant={allowVolumeExpansion ? 'default' : 'secondary'}>{allowVolumeExpansion ? 'Allowed' : 'Disabled'}</Badge>} />
          <DetailRow label="Default" value={isDefault ? 'Yes' : 'No'} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      {Object.keys(parameters).length > 0 && (
        <SectionCard icon={Settings} title="Parameters" tooltip={<p className="text-xs text-muted-foreground">Storage class parameters</p>}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {Object.entries(parameters).map(([key, value]) => (
              <DetailRow key={key} label={key} value={<span className="font-mono break-all">{String(value)}</span>} />
            ))}
          </div>
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={sc?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={sc?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function StorageClassDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sStorageClass>
      resourceType="storageclasses"
      kind="StorageClass"
      pluralLabel="Storage Classes"
      listPath="/storageclasses"
      resourceIcon={Layers}
      customTabs={customTabs}
      headerMetadata={(ctx) => {
        const isDefault = ctx.resource?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            {ctx.isConnected && <Badge variant="outline" className="text-xs">Live</Badge>}
            {isDefault && <><span className="mx-2">•</span><Star className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />Default</>}
          </span>
        );
      }}
      extraActionItems={() => [
        { icon: Star, label: 'Set as Default', description: 'Make this the default storage class', onClick: () => toast.info('Requires backend support') },
      ]}
      buildStatusCards={(ctx) => {
        const sc = ctx.resource;
        const provisioner = sc?.provisioner ?? '—';
        const reclaimPolicy = sc?.reclaimPolicy ?? 'Delete';
        const volumeBindingMode = sc?.volumeBindingMode ?? 'Immediate';

        return [
          { label: 'Provisioner', value: provisioner, icon: Server, iconColor: 'primary' as const },
          { label: 'Reclaim Policy', value: reclaimPolicy, icon: Settings, iconColor: 'info' as const },
          { label: 'Binding Mode', value: volumeBindingMode, icon: Layers, iconColor: 'muted' as const },
          { label: 'PVs/PVCs', value: '—', icon: Layers, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
