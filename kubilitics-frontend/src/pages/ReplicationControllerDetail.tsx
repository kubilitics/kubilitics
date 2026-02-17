import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { Layers, Clock, Server, Download, Trash2, Scale, AlertTriangle, Package, Network } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  ResourceDetailLayout,
  
  YamlViewer,
  YamlCompareViewer,
  EventsSection,
  ActionsSection,
  MetadataCard,
  ScaleDialog,
  DeleteConfirmDialog,
  ResourceTopologyView,
  
  
  type ResourceStatus,
  type EventInfo,
  type YamlVersion,
} from '@/components/resources';

const mockRC = {
  name: 'legacy-app',
  namespace: 'legacy',
  status: 'Healthy' as ResourceStatus,
  desired: 3,
  current: 3,
  ready: 3,
  age: '365d',
  createdAt: '2024-02-01T10:00:00Z',
  labels: { app: 'legacy-app', tier: 'backend', version: 'v1' },
  annotations: { 'kubernetes.io/description': 'Legacy application controller' },
  selector: { app: 'legacy-app' },
  template: {
    containers: [
      { 
        name: 'legacy-container', 
        image: 'legacy-app:v1.0',
        ports: [{ containerPort: 8080, protocol: 'TCP' }],
        resources: {
          requests: { cpu: '100m', memory: '128Mi' },
          limits: { cpu: '500m', memory: '512Mi' },
        }
      }
    ],
  },
  conditions: [
    { type: 'Available', status: 'True', lastTransitionTime: '2024-02-01T10:00:00Z' },
  ],
};

const mockEvents: EventInfo[] = [
  { type: 'Normal', reason: 'SuccessfulCreate', message: 'Created pod: legacy-app-abc12', time: '1h ago', count: 1 },
  { type: 'Normal', reason: 'SuccessfulCreate', message: 'Created pod: legacy-app-def34', time: '1h ago', count: 1 },
  { type: 'Normal', reason: 'SuccessfulCreate', message: 'Created pod: legacy-app-ghi56', time: '1h ago', count: 1 },
];

export default function ReplicationControllerDetail() {
  const { namespace, name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const rc = mockRC;

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob(['apiVersion: v1\nkind: ReplicationController\n...'], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rc.name || 'rc'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rc.name]);

  const yaml = 'apiVersion: v1\nkind: ReplicationController\n...';
  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Desired', value: rc.desired, icon: Layers, iconColor: 'primary' as const },
    { label: 'Current', value: rc.current, icon: Server, iconColor: 'info' as const },
    { label: 'Ready', value: rc.ready, icon: Package, iconColor: 'success' as const },
    { label: 'Age', value: rc.age, icon: Clock, iconColor: 'muted' as const },
  ];

  const handleScale = async (replicas: number) => {
    toast.success(`Scaled ${rc.name} to ${replicas} replicas (demo mode)`);
  };

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="space-y-6">
          {/* Deprecation Warning */}
          <Alert variant="destructive" className="border-warning/50 bg-warning/10">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle className="text-warning">Deprecated Resource</AlertTitle>
            <AlertDescription className="text-warning/80">
              ReplicationControllers are deprecated. Consider migrating to Deployments for rolling updates, rollback, and pause/resume functionality.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Replica Status */}
            <Card>
              <CardHeader><CardTitle className="text-base">Replica Status</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-primary">{rc.desired}</p>
                    <p className="text-muted-foreground">Desired</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-info">{rc.current}</p>
                    <p className="text-muted-foreground">Current</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-success">{rc.ready}</p>
                    <p className="text-muted-foreground">Ready</p>
                  </div>
                </div>
                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Readiness</span>
                    <span className="font-mono">{rc.ready}/{rc.desired}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${rc.desired > 0 ? (rc.ready / rc.desired) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Selector */}
            <Card>
              <CardHeader><CardTitle className="text-base">Selector</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(rc.selector).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-4">
                  Note: ReplicationControllers use equality-based selectors only. For set-based selectors, use ReplicaSets.
                </p>
              </CardContent>
            </Card>

            {/* Labels */}
            <MetadataCard
              title="Labels"
              items={rc.labels}
              variant="badges"
            />

            {/* Pod Template */}
            <Card className="lg:col-span-1">
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Pod Template
              </CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {rc.template.containers.map((container) => (
                    <div key={container.name} className="p-4 rounded-lg bg-muted/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{container.name}</p>
                        <Badge variant="outline" className="font-mono text-xs">{container.image}</Badge>
                      </div>
                      
                      {/* Ports */}
                      {container.ports && container.ports.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Ports</p>
                          <div className="flex flex-wrap gap-2">
                            {container.ports.map((port, idx) => (
                              <Badge key={idx} variant="secondary" className="font-mono text-xs">
                                {port.containerPort}/{port.protocol}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Resources */}
                      {container.resources && (
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <p className="text-muted-foreground mb-1">Requests</p>
                            <div className="space-y-0.5">
                              <p className="font-mono">CPU: {container.resources.requests.cpu}</p>
                              <p className="font-mono">Memory: {container.resources.requests.memory}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-muted-foreground mb-1">Limits</p>
                            <div className="space-y-0.5">
                              <p className="font-mono">CPU: {container.resources.limits.cpu}</p>
                              <p className="font-mono">Memory: {container.resources.limits.memory}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Migration Guidance */}
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Migration Guidance
              </CardTitle></CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="text-muted-foreground">
                    To migrate to a Deployment, create a new Deployment with the same pod template and selector.
                    Deployments provide additional features:
                  </p>
                  <ul className="text-muted-foreground mt-2 space-y-1">
                    <li>Rolling updates with configurable strategy</li>
                    <li>Rollback to previous revisions</li>
                    <li>Pause and resume deployments</li>
                    <li>Set-based label selectors</li>
                    <li>Revision history</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={mockEvents} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={rc.name} /> },
    { id: 'compare', label: 'Compare', content: <YamlCompareViewer versions={yamlVersions} resourceName={rc.name} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('ReplicationController')}
          namespace={namespace ?? ''}
          name={name ?? ''}
          sourceResourceType="ReplicationController"
          sourceResourceName={rc?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Scale, label: 'Scale', description: 'Adjust replica count', onClick: () => setShowScaleDialog(true) },
          { icon: Download, label: 'Download YAML', description: 'Export RC definition', onClick: handleDownloadYaml },
          { icon: Trash2, label: 'Delete RC', description: 'Remove this replication controller', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="ReplicationController"
        resourceIcon={Layers}
        name={rc.name}
        namespace={rc.namespace}
        status={rc.status}
        backLink="/replicationcontrollers"
        backLabel="Replication Controllers"
        headerMetadata={
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-warning border-warning/30 bg-warning/10">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Deprecated
            </Badge>
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Created {rc.age}</span>
          </div>
        }
        actions={[
          { label: 'Download YAML', icon: Download, variant: 'outline', onClick: handleDownloadYaml },
          { label: 'Scale', icon: Scale, variant: 'outline', onClick: () => setShowScaleDialog(true) },
          { label: 'Delete', icon: Trash2, variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]}
        statusCards={statusCards}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <ScaleDialog
        open={showScaleDialog}
        onOpenChange={setShowScaleDialog}
        resourceType="ReplicationController"
        resourceName={rc.name}
        namespace={rc.namespace}
        currentReplicas={rc.desired}
        onScale={handleScale}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        resourceType="ReplicationController"
        resourceName={rc.name}
        namespace={rc.namespace}
        onConfirm={() => {
          toast.success(`ReplicationController ${rc.name} deleted (demo mode)`);
          navigate('/replicationcontrollers');
        }}
        requireNameConfirmation
      />
    </>
  );
}
