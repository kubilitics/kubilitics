import { useNavigate } from 'react-router-dom';
import { Bell, Clock, Download, AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react';
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
import { downloadResourceJson } from '@/lib/exportUtils';
import { toast } from '@/components/ui/sonner';

interface EventResource extends KubernetesResource {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
    uid?: string;
  };
  source?: {
    component?: string;
    host?: string;
  };
}

function getInvolvedObjectLink(kind: string, name: string, namespace: string): string {
  const kindMap: Record<string, string> = {
    Pod: 'pods',
    Deployment: 'deployments',
    ReplicaSet: 'replicasets',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    Job: 'jobs',
    CronJob: 'cronjobs',
    Service: 'services',
    Ingress: 'ingresses',
    ConfigMap: 'configmaps',
    Secret: 'secrets',
    PersistentVolumeClaim: 'persistentvolumeclaims',
    PersistentVolume: 'persistentvolumes',
    Node: 'nodes',
    Namespace: 'namespaces',
    HorizontalPodAutoscaler: 'horizontalpodautoscalers',
    ServiceAccount: 'serviceaccounts',
  };
  const path = kindMap[kind];
  if (!path) return '#';
  if (kind === 'Node' || kind === 'PersistentVolume' || kind === 'Namespace') {
    return `/${path}/${name}`;
  }
  return `/${path}/${namespace}/${name}`;
}

function OverviewTab({ resource: ev }: ResourceContext<EventResource>) {
  const eventType = (ev?.type === 'Warning' || ev?.type === 'Error' ? ev.type : 'Normal') as 'Normal' | 'Warning' | 'Error';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Bell} title="Event" tooltip="Full event details">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Reason" value={ev?.reason ?? '–'} />
          <DetailRow label="Type" value={<Badge variant={eventType === 'Normal' ? 'secondary' : 'destructive'}>{eventType}</Badge>} />
          <DetailRow label="Count" value={<span className="font-mono">{ev?.count ?? 1}</span>} />
          <DetailRow label="Source" value={ev?.source?.component ?? '–'} />
          <DetailRow label="First Timestamp" value={<span className="font-mono">{ev?.firstTimestamp ?? '–'}</span>} />
          <DetailRow label="Last Timestamp" value={<span className="font-mono">{ev?.lastTimestamp ?? '–'}</span>} />
        </div>
      </SectionCard>
      <SectionCard icon={Bell} title="Message">
        <p className="text-sm font-semibold">{ev?.message ?? '–'}</p>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={ev?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={ev?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

function InvolvedResourceTab({ resource: ev }: ResourceContext<EventResource>) {
  const navigate = useNavigate();
  const involvedKind = ev?.involvedObject?.kind;
  const involvedName = ev?.involvedObject?.name;
  const involvedNs = ev?.involvedObject?.namespace ?? '';
  const involvedLink = involvedKind && involvedName
    ? getInvolvedObjectLink(involvedKind, involvedName, involvedNs)
    : '#';

  return (
    <SectionCard icon={Bell} title="Involved Resource">
      {involvedKind && involvedName ? (
        <div>
          <p className="text-sm text-muted-foreground mb-2">This event is about the following resource:</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{involvedKind}</Badge>
            <span className="font-mono text-sm font-semibold">{involvedName}</span>
            {involvedNs && <Badge variant="outline">{involvedNs}</Badge>}
            {involvedLink !== '#' && (
              <Button variant="link" size="sm" className="gap-1" onClick={() => navigate(involvedLink)}>
                View resource <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No involved object.</p>
      )}
    </SectionCard>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  { id: 'involved', label: 'Involved Resource', icon: Bell, render: (ctx) => <InvolvedResourceTab {...ctx} /> },
];

export default function EventDetail() {
  return (
    <GenericResourceDetail<EventResource>
      resourceType="events"
      kind="Event"
      pluralLabel="Events"
      listPath="/events"
      resourceIcon={Bell}
      customTabs={customTabs}
      deriveStatus={(ev: EventResource): ResourceStatus => {
        const eventType = (ev?.type === 'Warning' || ev?.type === 'Error' ? ev.type : 'Normal') as 'Normal' | 'Warning' | 'Error';
        return eventType === 'Normal' ? 'Healthy' : eventType === 'Warning' ? 'Warning' : 'Failed';
      }}
      headerMetadata={(ctx) => {
        const ev = ctx.resource;
        const eventType = (ev?.type === 'Warning' || ev?.type === 'Error' ? ev.type : 'Normal') as 'Normal' | 'Warning' | 'Error';
        const eventNamespace = ev?.metadata?.namespace ?? '';
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Badge variant={eventType === 'Normal' ? 'secondary' : 'destructive'}>{eventType}</Badge>
            <span>{ev?.reason}</span>
            {eventNamespace && <Badge variant="outline">{eventNamespace}</Badge>}
          </span>
        );
      }}
      headerActions={(ctx) => [
        { label: 'Download YAML', icon: Download, variant: 'outline', onClick: () => {
          const blob = new Blob([ctx.yaml], { type: 'application/yaml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `event-${ctx.namespace}-${ctx.name}.yaml`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }, className: 'press-effect' },
        { label: 'Export as JSON', icon: Download, variant: 'outline', onClick: () => {
          downloadResourceJson(ctx.resource, `event-${ctx.namespace}-${ctx.name}.json`);
          toast.success('JSON downloaded');
        }, className: 'press-effect' },
      ]}
      buildStatusCards={(ctx) => {
        const ev = ctx.resource;
        const eventType = (ev?.type === 'Warning' || ev?.type === 'Error' ? ev.type : 'Normal') as 'Normal' | 'Warning' | 'Error';
        const involvedKind = ev?.involvedObject?.kind;
        const involvedName = ev?.involvedObject?.name;
        return [
          { label: 'Type', value: eventType, icon: eventType === 'Normal' ? CheckCircle2 : AlertTriangle, iconColor: (eventType === 'Normal' ? 'success' : 'warning') as const },
          { label: 'Reason', value: ev?.reason ?? '–', icon: Bell, iconColor: 'primary' as const },
          { label: 'Involved Object', value: involvedKind && involvedName ? `${involvedKind}/${involvedName}` : '–', icon: Bell, iconColor: 'muted' as const },
          { label: 'Source', value: ev?.source?.component ?? '–', icon: Bell, iconColor: 'muted' as const },
          { label: 'Count', value: ev?.count ?? 1, icon: Bell, iconColor: 'muted' as const },
          { label: 'First Seen', value: ev?.firstTimestamp ? new Date(ev.firstTimestamp).toISOString() : '–', icon: Clock, iconColor: 'muted' as const },
          { label: 'Last Seen', value: ev?.lastTimestamp ? new Date(ev.lastTimestamp).toISOString() : '–', icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
