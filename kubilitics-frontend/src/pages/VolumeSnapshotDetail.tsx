import { useParams, useNavigate } from 'react-router-dom';
import { Camera, Link2, FileText, Info } from 'lucide-react';
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

interface VolumeSnapshotResource extends KubernetesResource {
  spec?: {
    source?: { persistentVolumeClaimName?: string; volumeSnapshotContentName?: string };
    volumeSnapshotClassName?: string;
  };
  status?: {
    readyToUse?: boolean;
    boundVolumeSnapshotContentName?: string;
    restoreSize?: string;
    creationTime?: string;
    error?: { message?: string };
  };
}

function OverviewTab({ resource: vs, age }: ResourceContext<VolumeSnapshotResource>) {
  const navigate = useNavigate();
  const { namespace } = useParams();
  const spec = vs?.spec ?? {};
  const status = vs?.status ?? {};
  const source = spec.source ?? {};
  const sourcePVC = source.persistentVolumeClaimName ?? '-';
  const snapshotClass = spec.volumeSnapshotClassName ?? '-';
  const boundContent = status.boundVolumeSnapshotContentName ?? '-';
  const restoreSize = status.restoreSize ?? '-';
  const readyToUse = status.readyToUse === true;
  const errorMsg = status.error?.message;
  const name = vs?.metadata?.name ?? '';

  const restoreInstructions = readyToUse && sourcePVC !== '-' ? (
    <pre className="text-sm font-mono bg-muted/50 p-4 rounded-lg overflow-x-auto">
      {`# Restore from this snapshot to a new PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-restored-pvc
  namespace: ${namespace}
spec:
  storageClassName: ""  # Same as original or your choice
  dataSource:
    name: ${name}
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: ${restoreSize}`}
    </pre>
  ) : null;

  return (
    <div className="space-y-6">
      <SectionCard icon={Camera} title="Snapshot Details">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Status" value={<Badge variant={readyToUse ? 'default' : (errorMsg ? 'destructive' : 'secondary')}>{readyToUse ? 'Ready' : (errorMsg ? 'Failed' : 'Pending')}</Badge>} />
          <DetailRow label="Source PVC" value={
            <Button variant="link" className="h-auto p-0 font-normal" onClick={() => navigate(`/persistentvolumeclaims/${namespace}/${sourcePVC}`)}>
              {sourcePVC}
              <Link2 className="h-3 w-3 ml-1 inline" />
            </Button>
          } />
          <DetailRow label="Snapshot Class" value={<span className="font-mono text-sm">{snapshotClass}</span>} />
          <DetailRow label="Bound Content" value={<span className="font-mono text-sm">{boundContent}</span>} />
          <DetailRow label="Restore Size" value={<span className="font-mono">{restoreSize}</span>} />
          <DetailRow label="Created" value={vs?.metadata?.creationTimestamp ? new Date(vs.metadata.creationTimestamp).toLocaleString() : '—'} />
        </div>
      </SectionCard>
      {errorMsg && (
        <SectionCard icon={Camera} title="Error">
          <p className="text-destructive text-sm">{errorMsg}</p>
        </SectionCard>
      )}
      {restoreInstructions && (
        <SectionCard icon={Camera} title="Restore Instructions">
          <p className="text-sm text-muted-foreground mb-2">Use this YAML to create a new PVC from this snapshot:</p>
          {restoreInstructions}
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={vs?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={vs?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function VolumeSnapshotDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<VolumeSnapshotResource>
      resourceType="volumesnapshots"
      kind="VolumeSnapshot"
      pluralLabel="Volume Snapshots"
      listPath="/volumesnapshots"
      resourceIcon={Camera}
      customTabs={customTabs}
      deriveStatus={(vs) => {
        const readyToUse = vs?.status?.readyToUse === true;
        const errorMsg = vs?.status?.error?.message;
        return readyToUse ? 'Healthy' : errorMsg ? 'Failed' : 'Pending';
      }}
      buildStatusCards={(ctx) => {
        const vs = ctx.resource;
        const spec = vs?.spec ?? {};
        const status = vs?.status ?? {};
        const source = spec.source ?? {};
        const sourcePVC = source.persistentVolumeClaimName ?? '-';
        const snapshotClass = spec.volumeSnapshotClassName ?? '-';
        const restoreSize = status.restoreSize ?? '-';
        const readyToUse = status.readyToUse === true;
        const errorMsg = status.error?.message;

        return [
          { label: 'Status', value: readyToUse ? 'Ready' : errorMsg ? 'Failed' : 'Pending', icon: Camera, iconColor: (readyToUse ? 'success' : errorMsg ? 'destructive' : 'warning') as const },
          { label: 'Source PVC', value: sourcePVC, icon: Link2, iconColor: 'info' as const },
          { label: 'Snapshot Class', value: snapshotClass, icon: FileText, iconColor: 'muted' as const },
          { label: 'Restore Size', value: restoreSize, icon: Camera, iconColor: 'primary' as const },
        ];
      }}
    />
  );
}
