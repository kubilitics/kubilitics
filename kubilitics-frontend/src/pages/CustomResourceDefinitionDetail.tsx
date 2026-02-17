import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { normalizeKindForTopology } from '@/utils/resourceKindMapper';
import { FileCode, Clock, Layers, Download, Trash2, Package, Code, List, ExternalLink, Network } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  ResourceDetailLayout,
  
  YamlViewer,
  YamlCompareViewer,
  EventsSection,
  ActionsSection,
  DeleteConfirmDialog,
  ResourceTopologyView,
  
  
  type ResourceStatus,
  type EventInfo,
  type YamlVersion,
} from '@/components/resources';

const mockCRD = {
  name: 'certificates.cert-manager.io',
  status: 'Established' as ResourceStatus,
  group: 'cert-manager.io',
  version: 'v1',
  scope: 'Namespaced',
  kind: 'Certificate',
  plural: 'certificates',
  singular: 'certificate',
  shortNames: ['cert', 'certs'],
  age: '90d',
  versions: [
    { name: 'v1', served: true, storage: true },
    { name: 'v1alpha2', served: true, storage: false },
  ],
  conditions: [
    { type: 'Established', status: 'True', reason: 'InitialNamesAccepted' },
    { type: 'NamesAccepted', status: 'True', reason: 'NoConflicts' },
  ],
  printerColumns: [
    { name: 'Ready', type: 'string', jsonPath: '.status.conditions[?(@.type=="Ready")].status' },
    { name: 'Secret', type: 'string', jsonPath: '.spec.secretName' },
    { name: 'Age', type: 'date', jsonPath: '.metadata.creationTimestamp' },
  ],
};

// Mock custom resource instances
const mockCRInstances = [
  { name: 'my-tls-cert', namespace: 'production', ready: true },
  { name: 'api-cert', namespace: 'production', ready: true },
  { name: 'staging-cert', namespace: 'staging', ready: false },
];

const mockEvents: EventInfo[] = [];

export default function CustomResourceDefinitionDetail() {
  const { name } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const crd = mockCRD;

  const handleDownloadYaml = useCallback(() => {
    const blob = new Blob(['apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\n...'], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${crd.name || 'crd'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [crd.name]);

  const yaml = 'apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\n...';
  const yamlVersions: YamlVersion[] = yaml ? [{ id: 'current', label: 'Current Version', yaml, timestamp: 'now' }] : [];

  const statusCards = [
    { label: 'Group', value: crd.group, icon: Package, iconColor: 'primary' as const },
    { label: 'Version', value: crd.version, icon: Layers, iconColor: 'info' as const },
    { label: 'Scope', value: crd.scope, icon: FileCode, iconColor: 'success' as const },
    { label: 'Age', value: crd.age, icon: Clock, iconColor: 'muted' as const },
  ];

  const tabs = [
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">CRD Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Group</p>
                  <p className="font-mono">{crd.group}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Kind</p>
                  <Badge variant="default">{crd.kind}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Plural</p>
                  <p className="font-mono">{crd.plural}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Singular</p>
                  <p className="font-mono">{crd.singular}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Scope</p>
                  <Badge variant="outline">{crd.scope}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Short Names</p>
                  <div className="flex gap-1 flex-wrap">
                    {crd.shortNames.map((sn) => (
                      <Badge key={sn} variant="secondary" className="font-mono text-xs">{sn}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Versions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {crd.versions.map((ver) => (
                  <div key={ver.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Badge variant={ver.storage ? 'default' : 'secondary'}>{ver.name}</Badge>
                      {ver.storage && <Badge variant="outline" className="text-xs">Storage</Badge>}
                    </div>
                    <Badge variant={ver.served ? 'default' : 'secondary'}>
                      {ver.served ? 'Served' : 'Not Served'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {crd.conditions.map((condition) => (
                  <div key={condition.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Badge variant={condition.status === 'True' ? 'default' : 'secondary'}>
                      {condition.type}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{condition.reason}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <List className="h-4 w-4" />
                Printer Columns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {crd.printerColumns.map((col) => (
                  <div key={col.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{col.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{col.jsonPath}</p>
                    </div>
                    <Badge variant="outline">{col.type}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      id: 'instances',
      label: `Instances (${mockCRInstances.length})`,
      content: (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custom Resource Instances</CardTitle>
            <CardDescription>
              All {crd.kind} resources in the cluster
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mockCRInstances.map((cr) => (
                <div 
                  key={cr.name}
                  className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={cr.ready ? 'default' : 'secondary'}>
                      {cr.ready ? 'Ready' : 'Not Ready'}
                    </Badge>
                    <div>
                      <p className="font-medium">{cr.name}</p>
                      <p className="text-xs text-muted-foreground">{cr.namespace}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      id: 'schema',
      label: 'Schema',
      content: (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Code className="h-4 w-4" />
              OpenAPI Schema
            </CardTitle>
            <CardDescription>
              The validation schema for {crd.kind} resources
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="p-4 rounded-lg bg-muted/50 overflow-auto text-sm font-mono">
{`openAPIV3Schema:
  type: object
  properties:
    spec:
      type: object
      properties:
        secretName:
          type: string
          description: The name of the secret to store the certificate
        issuerRef:
          type: object
          properties:
            name:
              type: string
            kind:
              type: string
              enum: [Issuer, ClusterIssuer]
        dnsNames:
          type: array
          items:
            type: string
        duration:
          type: string
    status:
      type: object
      properties:
        conditions:
          type: array`}
            </pre>
          </CardContent>
        </Card>
      ),
    },
    { id: 'events', label: 'Events', content: <EventsSection events={mockEvents} /> },
    { id: 'yaml', label: 'YAML', content: <YamlViewer yaml={yaml} resourceName={crd.name} editable onSave={handleSaveYaml} /> },
    { id: 'compare', label: 'Compare', content: <YamlCompareViewer versions={yamlVersions} resourceName={crd.name} /> },
    {
      id: 'topology',
      label: 'Topology',
      icon: Network,
      content: (
        <ResourceTopologyView
          kind={normalizeKindForTopology('CustomResourceDefinition')}
          namespace={''}
          name={name ?? ''}
          sourceResourceType="CustomResourceDefinition"
          sourceResourceName={crd?.name ?? name ?? ''}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      content: (
        <ActionsSection actions={[
          { icon: Download, label: 'Download YAML', description: 'Export CRD definition', onClick: handleDownloadYaml },
          { icon: Trash2, label: 'Delete CRD', description: 'Remove this custom resource definition', variant: 'destructive', onClick: () => setShowDeleteDialog(true) },
        ]} />
      ),
    },
  ];

  return (
    <>
      <ResourceDetailLayout
        resourceType="CustomResourceDefinition"
        resourceIcon={FileCode}
        name={crd.name}
        status="Healthy"
        backLink="/customresourcedefinitions"
        backLabel="Custom Resource Definitions"
        headerMetadata={<span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />Created {crd.age}</span>}
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
        resourceType="CustomResourceDefinition"
        resourceName={crd.name}
        onConfirm={() => {
          toast.success(`CRD ${crd.name} deleted (demo mode)`);
          navigate('/customresourcedefinitions');
        }}
        requireNameConfirmation
      />
    </>
  );
}
