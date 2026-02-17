import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, Trash2, Loader2, FileText, Link2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  SectionCard,
  YamlViewer,
  EventsSection,
  DeleteConfirmDialog,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { Breadcrumbs, useDetailBreadcrumbs } from '@/components/layout/Breadcrumbs';
import { useClusterStore } from '@/stores/clusterStore';

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

export default function VolumeSnapshotDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const { activeCluster } = useClusterStore();
  const breadcrumbSegments = useDetailBreadcrumbs('VolumeSnapshot', name ?? undefined, namespace ?? undefined, activeCluster?.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { resource: vs, isLoading, yaml, isConnected, refetch } = useResourceDetail<VolumeSnapshotResource>(
    'volumesnapshots',
    name ?? '',
    namespace ?? 'default',
    undefined as unknown as VolumeSnapshotResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('VolumeSnapshot', namespace ?? '', name ?? undefined);
  const deleteVS = useDeleteK8sResource('volumesnapshots');

  useEffect(() => {
    setActiveTab(searchParams.get('tab') || 'overview');
  }, [searchParams]);

  useEffect(() => {
    if (!name?.trim() || !namespace?.trim()) navigate('/volumesnapshots', { replace: true });
  }, [name, namespace, navigate]);

  const handleDelete = async () => {
    if (!namespace || !name) return;
    await deleteVS.mutateAsync({ name, namespace });
    navigate('/volumesnapshots');
  };

  if (!name?.trim() || !namespace?.trim()) return null;
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && name && !vs?.metadata?.name) {
    return (
      <div className="space-y-4 p-6">
        <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">VolumeSnapshot not found.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate('/volumesnapshots')}>
              Back to Volume Snapshots
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const spec = vs?.spec ?? {};
  const status = vs?.status ?? {};
  const source = spec.source ?? {};
  const sourcePVC = source.persistentVolumeClaimName ?? '-';
  const snapshotClass = spec.volumeSnapshotClassName ?? '-';
  const boundContent = status.boundVolumeSnapshotContentName ?? '-';
  const restoreSize = status.restoreSize ?? '-';
  const readyToUse = status.readyToUse === true;
  const errorMsg = status.error?.message;

  const statusCards = [
    { label: 'Status', value: readyToUse ? 'Ready' : errorMsg ? 'Failed' : 'Pending', variant: readyToUse ? 'success' : errorMsg ? 'destructive' : 'warning' as const },
    { label: 'Source PVC', value: sourcePVC },
    { label: 'Snapshot Class', value: snapshotClass },
    { label: 'Restore Size', value: restoreSize },
  ];

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
      <Breadcrumbs segments={breadcrumbSegments} className="mb-2" />
      <ResourceDetailLayout
        icon={<Camera className="h-6 w-6 text-primary" />}
        title={vs?.metadata?.name ?? name}
        namespace={namespace}
        status={readyToUse ? 'Ready' : errorMsg ? 'Failed' : 'Pending'}
        createdAt={vs?.metadata?.creationTimestamp}
        onRefresh={handleRefresh}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(true)} className="gap-2 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </>
        }
        tabs={[
          { id: 'overview', label: 'Overview', icon: FileText },
          { id: 'yaml', label: 'YAML', icon: FileText },
          { id: 'events', label: 'Events', icon: FileText },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {statusCards.map((c) => (
                <SectionCard key={c.label} title={c.label}>
                  {c.variant ? (
                    <Badge variant={c.variant === 'success' ? 'default' : c.variant === 'destructive' ? 'destructive' : 'secondary'}>
                      {c.value}
                    </Badge>
                  ) : c.label === 'Source PVC' && sourcePVC !== '-' ? (
                    <Button variant="link" className="h-auto p-0 font-normal" onClick={() => navigate(`/persistentvolumeclaims/${namespace}/${sourcePVC}`)}>
                      {sourcePVC}
                      <Link2 className="h-3 w-3 ml-1 inline" />
                    </Button>
                  ) : (
                    <span className="font-mono text-sm">{c.value}</span>
                  )}
                </SectionCard>
              ))}
            </div>
            <ResourceOverviewMetadata resource={vs} />
            {errorMsg && (
              <SectionCard title="Error">
                <p className="text-destructive text-sm">{errorMsg}</p>
              </SectionCard>
            )}
            {boundContent !== '-' && (
              <SectionCard title="Bound Volume Snapshot Content">
                <p className="text-sm font-mono">{boundContent}</p>
              </SectionCard>
            )}
            {restoreInstructions && (
              <SectionCard title="Restore Instructions">
                <p className="text-sm text-muted-foreground mb-2">Use this YAML to create a new PVC from this snapshot:</p>
                {restoreInstructions}
              </SectionCard>
            )}
          </div>
        )}
        {activeTab === 'yaml' && yaml && <YamlViewer yaml={yaml} resourceName={name} resourceKind="VolumeSnapshot" />}
        {activeTab === 'events' && <EventsSection events={events} onRefresh={refetchEvents} />}
      </ResourceDetailLayout>

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="VolumeSnapshot"
        resourceName={name ?? ''}
        namespace={namespace}
        onConfirm={handleDelete}
      />
    </div>
  );
}
