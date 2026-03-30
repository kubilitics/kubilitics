import { Link } from 'react-router-dom';
import { Network, Clock, Globe, Server, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

interface EndpointSliceResource extends KubernetesResource {
  addressType?: string;
  endpoints?: Array<{
    addresses?: string[];
    conditions?: { ready?: boolean; serving?: boolean; terminating?: boolean };
    targetRef?: { kind: string; name: string; namespace: string };
    zone?: string;
  }>;
  ports?: Array<{ name?: string; port?: number; protocol?: string }>;
}

function OverviewTab({ resource: es, age }: ResourceContext<EndpointSliceResource>) {
  const addressType = es.addressType ?? '—';
  const endpointsList = es.endpoints ?? [];
  const portsList = es.ports ?? [];
  const labels = es.metadata?.labels ?? {};
  const namespace = es.metadata?.namespace || '';
  const serviceName = labels['kubernetes.io/service-name'];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="EndpointSlice Info" icon={Network}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Address Type" value={addressType} />
            <DetailRow label="Age" value={age} />
            {serviceName && <DetailRow label="Service" value={<Link to={`/services/${namespace}/${serviceName}`} className="text-primary hover:underline">{serviceName}</Link>} />}
          </div>
        </SectionCard>
        <SectionCard title="Ports" icon={Globe}>
          {portsList.length === 0 ? <p className="text-muted-foreground text-sm">No ports</p> : portsList.map((port, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 mb-2">
              <div>
                <p className="font-medium text-sm">{port.name || 'unnamed'}</p>
                <p className="text-xs text-muted-foreground">{port.protocol ?? 'TCP'}</p>
              </div>
              <Badge variant="secondary" className="font-mono">{port.port}</Badge>
            </div>
          ))}
        </SectionCard>
        <SectionCard title="Endpoints" icon={Server} className="lg:col-span-2">
          <div className="space-y-3">
            {endpointsList.map((ep, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm break-all">{(ep.addresses ?? []).join(', ')}</span>
                  <Badge variant={ep.conditions?.ready ? 'default' : 'secondary'} className={ep.conditions?.ready ? 'bg-green-600' : ''}>{ep.conditions?.ready ? 'Ready' : 'Not Ready'}</Badge>
                </div>
                {ep.targetRef?.kind === 'Pod' && (
                  <Link to={`/pods/${ep.targetRef.namespace}/${ep.targetRef.name}`} className="text-xs text-primary hover:underline">
                    → Pod/{ep.targetRef.name}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={labels} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={es?.metadata?.annotations || {}} />
      </div>
    </div>
  );
}

function EndpointDetailsTab({ resource: es }: ResourceContext<EndpointSliceResource>) {
  const endpointsList = es.endpoints ?? [];

  return (
    <SectionCard title="Endpoint details" icon={Server}>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Addresses</th><th className="text-left p-2">Ready</th><th className="text-left p-2">Serving</th><th className="text-left p-2">Terminating</th><th className="text-left p-2">Pod</th></tr></thead>
          <tbody>
            {endpointsList.map((ep, i) => (
              <tr key={i} className="border-b">
                <td className="p-2 font-mono">{(ep.addresses ?? []).join(', ')}</td>
                <td className="p-2">{ep.conditions?.ready != null ? (ep.conditions.ready ? 'Yes' : 'No') : '—'}</td>
                <td className="p-2">{ep.conditions?.serving != null ? (ep.conditions.serving ? 'Yes' : 'No') : '—'}</td>
                <td className="p-2">{ep.conditions?.terminating != null ? (ep.conditions.terminating ? 'Yes' : 'No') : '—'}</td>
                <td className="p-2">{ep.targetRef?.kind === 'Pod' ? <Link to={`/pods/${ep.targetRef.namespace}/${ep.targetRef.name}`} className="text-primary hover:underline">{ep.targetRef.name}</Link> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function ZoneTopologyTab({ resource: es }: ResourceContext<EndpointSliceResource>) {
  const endpointsList = es.endpoints ?? [];

  return (
    <SectionCard title="Zone topology" icon={Globe}>
      {endpointsList.some((e) => e.zone) ? (
        <div className="space-y-2">
          {Array.from(new Set(endpointsList.map((e) => e.zone).filter(Boolean))).map((zone) => (
            <div key={zone} className="p-3 rounded-lg bg-muted/50">
              <p className="font-medium">{zone}</p>
              <p className="text-sm text-muted-foreground">{endpointsList.filter((e) => e.zone === zone).length} endpoint(s)</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No zone information.</p>
      )}
    </SectionCard>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  { id: 'endpoints', label: 'Endpoint Details', icon: Server, render: (ctx) => <EndpointDetailsTab {...ctx} /> },
  { id: 'zones', label: 'Zone Topology', icon: Globe, render: (ctx) => <ZoneTopologyTab {...ctx} /> },
];

export default function EndpointSliceDetail() {
  return (
    <GenericResourceDetail<EndpointSliceResource>
      resourceType="endpointslices"
      kind="EndpointSlice"
      pluralLabel="Endpoint Slices"
      listPath="/endpointslices"
      resourceIcon={Network}
      customTabs={customTabs}
      deriveStatus={(es: EndpointSliceResource): ResourceStatus => {
        const endpointsList = es.endpoints ?? [];
        return endpointsList.some((e) => e.conditions?.ready) ? 'Healthy' : 'Pending';
      }}
      buildStatusCards={(ctx) => {
        const es = ctx.resource;
        const addressType = es.addressType ?? '—';
        const endpointsList = es.endpoints ?? [];
        const portsList = es.ports ?? [];
        return [
          { label: 'Address Type', value: addressType, icon: Network, iconColor: 'primary' as const },
          { label: 'Endpoints', value: String(endpointsList.length), icon: Server, iconColor: 'success' as const },
          { label: 'Ports', value: String(portsList.length), icon: Globe, iconColor: 'info' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
