import { useNavigate } from 'react-router-dom';
import { Database, Clock, Server, HardDrive, Info } from 'lucide-react';
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
} from '@/components/resources';
import { type KubernetesResource } from '@/hooks/useKubernetes';

interface K8sVolumeAttachment extends KubernetesResource {
  spec?: {
    attacher?: string;
    nodeName?: string;
    source?: { persistentVolumeName?: string };
  };
  status?: {
    attached?: boolean;
    attachError?: { message?: string };
    detachError?: { message?: string };
    attachmentMetadata?: Record<string, string>;
  };
}

function OverviewTab({ resource: va, age }: ResourceContext<K8sVolumeAttachment>) {
  const navigate = useNavigate();
  const attacher = va?.spec?.attacher ?? '—';
  const nodeName = va?.spec?.nodeName ?? '—';
  const pvName = va?.spec?.source?.persistentVolumeName ?? '—';
  const attached = !!va?.status?.attached;
  const attachError = va?.status?.attachError?.message ?? va?.status?.detachError?.message ?? '—';
  const attachmentMetadata = va?.status?.attachmentMetadata ?? {};

  return (
    <div className="space-y-6">
      <SectionCard icon={Database} title="Attachment information" tooltip={<p className="text-xs text-muted-foreground">Volume attachment status and references</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Attacher" value={<span className="font-mono text-xs break-all">{attacher}</span>} />
          <DetailRow label="Status" value={<Badge variant={attached ? 'default' : 'secondary'}>{attached ? 'Attached' : 'Detached'}</Badge>} />
          <DetailRow
            label="Node"
            value={
              nodeName !== '—' ? (
                <Button variant="link" className="h-auto p-0 font-mono text-left break-all" onClick={() => navigate(`/nodes/${nodeName}`)}>
                  {nodeName}
                </Button>
              ) : '—'
            }
          />
          <DetailRow
            label="PersistentVolume"
            value={
              pvName !== '—' ? (
                <Button variant="link" className="h-auto p-0 font-mono text-left break-all" onClick={() => navigate(`/persistentvolumes/${pvName}`)}>
                  {pvName}
                </Button>
              ) : '—'
            }
          />
          <DetailRow label="Age" value={age} />
          {attachError !== '—' && (
            <DetailRow label="Attach Error" value={<span className="text-destructive">{attachError}</span>} />
          )}
        </div>
      </SectionCard>
      {Object.keys(attachmentMetadata).length > 0 && (
        <SectionCard icon={Info} title="Attachment Metadata" tooltip={<p className="text-xs text-muted-foreground">Driver-specific metadata</p>}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {Object.entries(attachmentMetadata).map(([key, value]) => (
              <DetailRow key={key} label={key} value={<span className="font-mono break-all">{value}</span>} />
            ))}
          </div>
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={va?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={va?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function VolumeAttachmentDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sVolumeAttachment>
      resourceType="volumeattachments"
      kind="VolumeAttachment"
      pluralLabel="Volume Attachments"
      listPath="/volumeattachments"
      resourceIcon={Database}
      customTabs={customTabs}
      deriveStatus={(va) => (va?.status?.attached ? 'Healthy' : 'Pending')}
      buildStatusCards={(ctx) => {
        const va = ctx.resource;
        const attached = !!va?.status?.attached;
        const nodeName = va?.spec?.nodeName ?? '—';
        const pvName = va?.spec?.source?.persistentVolumeName ?? '—';

        return [
          { label: 'Status', value: attached ? 'Attached' : 'Detached', icon: Database, iconColor: 'success' as const },
          { label: 'Node', value: nodeName, icon: Server, iconColor: 'info' as const },
          { label: 'PV', value: pvName, icon: HardDrive, iconColor: 'primary' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
