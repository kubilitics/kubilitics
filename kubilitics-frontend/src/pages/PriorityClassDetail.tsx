import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, ArrowUpDown, Download, Trash2, Shield, Network } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  ResourceDetailLayout,
  ResourceOverviewMetadata,
  YamlViewer,
  YamlCompareViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  type ResourceStatus,
  type YamlVersion,
} from '@/components/resources';
import { useResourceDetail, useResourceEvents } from '@/hooks/useK8sResourceDetail';
import { useDeleteK8sResource, type KubernetesResource } from '@/hooks/useKubernetes';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { toast } from 'sonner';

interface PriorityClassResource extends KubernetesResource {
  value?: number;
  globalDefault?: boolean;
  preemptionPolicy?: string;
  description?: string;
}

export default function PriorityClassDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { isConnected } = useConnectionStatus();

  const { resource, isLoading, error: resourceError, age, yaml, refetch } = useResourceDetail<PriorityClassResource>(
    'priorityclasses',
    name ?? undefined,
    undefined,
    undefined as unknown as PriorityClassResource
  );
  const { events, refetch: refetchEvents } = useResourceEvents('PriorityClass', undefined, name ?? undefined);
  const deleteResource = useDeleteK8sResource('priorityclasses');

  const pcName = resource?.metadata?.name ?? name ?? '';
  const value = typeof resource?.value === 'number' ? resource.value : 0;
  const globalDefault = !!resource?.globalDefault;
  const preemptionPolicy = resource?.preemptionPolicy ?? 'PreemptLowerPriority';
  const description = resource?.description ?? '';

  const handleDownloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pcName || 'priorityclass'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml, pcName]);

  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Value', value: value.toLocaleString(), icon: ArrowUpDown, iconColor: 'primary' as const },
    { label: 'Global Default', value: globalDefault ? 'Yes' : 'No', icon: Shield, iconColor: 'info' as const },
    { label: 'Preemption Policy', value: preemptionPolicy, icon: AlertTriangle, iconColor: 'muted' as const },
    { label: 'Pods Using', value: '–', icon: AlertTriangle, iconColor: 'muted' as const },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (isConnected && (resourceError || !resource?.metadata?.name)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium">Priority Class not found</p>
        <p className="text-sm text-muted-foreground">
          {name ? `No priority class "${name}".` : 'Missing name.'}
        </p>
        <Button variant="outline" onClick={() => navigate('/priorityclasses')}>Back to Priority Classes</Button>
      </div>
    );
  }

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          <ResourceOverviewMetadata
            metadata={resource?.metadata ?? { name: pcName }}
            createdLabel={age}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Priority Class Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Priority Value</p>
                  <p className="font-mono text-lg font-bold text-primary">{value.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Global Default</p>
                  <Badge variant={globalDefault ? 'default' : 'secondary'}>
                    {globalDefault ? 'Yes' : 'No'}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Preemption Policy</p>
                  <Badge variant="outline">{preemptionPolicy}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Age</p>
                  <p>{age}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{description || '–'}</p>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Priority Scale</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500"
                    style={{ width: `${Math.min((value / 2000001000) * 100, 100)}%` }}
                  />
                </div>
                <Badge variant="default">{value.toLocaleString()}</Badge>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>0 (Lowest)</span>
                <span>2,000,001,000 (Highest)</span>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>
      ),
    },
    {
      id: 'pod-distribution',
      label: 'Pod Distribution',
      content: (
        <Card>
          <CardHeader><CardTitle className="text-base">Pods Using This Priority Class</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Pods with <code>spec.priorityClassName: {pcName}</code> can be listed by viewing Pods and filtering by priority class.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate('/pods')}>View Pods</Button>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={events} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={pcName} /> },
    { id: 'compare', label: 'Compare', content: <YamlCompareViewer versions={yamlVersions} resourceName={pcName} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('PriorityClass')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="PriorityClass"
          sourceResourceName={resource?.metadata?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection
          actions={[
            { icon: Download, label: 'Download YAML', description: 'Export PriorityClass definition', onClick: handleDownloadYaml },
            { icon: Trash2, label: 'Delete PriorityClass', description: 'Remove this priority class', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
          ]}
        />
      ),
    },
  ];

  const status: ResourceStatus = 'Healthy';

  return (
    <>
      <ResourceDetailLayout
        resourceType="PriorityClass"
        resourceIcon={AlertTriangle}
        name={pcName}
        status={status}
        backLink="/priorityclasses"
        backLabel="Priority Classes"
        createdLabel={age}
        createdAt={resource?.metadata?.creationTimestamp}
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="PriorityClass"
        resourceName={pcName}
        onConfirm={async () => {
          await deleteResource.mutateAsync({ name: pcName });
          navigate('/priorityclasses');
        }}
        requireNameConfirmation
      />
    </>
  );
}
