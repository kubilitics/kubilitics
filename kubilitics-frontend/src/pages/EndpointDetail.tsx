import { Link, useNavigate } from 'react-router-dom';
import { Network, Server, Globe, Activity, Info } from 'lucide-react';
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

interface EndpointsResource extends KubernetesResource {
  subsets?: Array<{
    addresses?: Array<{ ip: string; hostname?: string; nodeName?: string; targetRef?: { kind: string; namespace: string; name: string } }>;
    notReadyAddresses?: Array<{ ip: string; targetRef?: { kind: string; name: string; namespace: string } }>;
    ports?: Array<{ name?: string; port: number; protocol?: string }>;
  }>;
}

function OverviewTab({ resource: ep, age }: ResourceContext<EndpointsResource>) {
  const namespace = ep.metadata?.namespace || '';
  const epName = ep.metadata?.name || '';
  const subsets = ep.subsets ?? [];

  return (
    <div className="space-y-6">
      <SectionCard title="Metadata & Subsets" icon={Network}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Service (same name)" value={epName ? <Link to={`/services/${namespace}/${epName}`} className="text-primary hover:underline">{epName}</Link> : '—'} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      {subsets.map((subset, idx) => (
        <SectionCard key={idx} title={`Subset ${idx + 1}`} icon={Server}>
          <div className="space-y-4">
            <div>
              <h4 className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-3">Ports</h4>
              <div className="flex gap-2">
                {(subset.ports ?? []).map((port) => (
                  <Badge key={port.name || port.port} variant="secondary" className="font-mono">
                    {port.name ?? 'port'}: {port.port}/{port.protocol ?? 'TCP'}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-3">Addresses</h4>
              <div className="space-y-2">
                {(subset.addresses ?? []).map((addr) => (
                  <div key={addr.ip} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm">{addr.ip}</span>
                      {addr.nodeName && <Badge variant="outline">{addr.nodeName}</Badge>}
                    </div>
                    <span className="text-sm text-muted-foreground">{addr.targetRef?.kind === 'Pod' ? <Link to={`/pods/${addr.targetRef.namespace}/${addr.targetRef.name}`} className="text-primary hover:underline">{addr.targetRef.name}</Link> : addr.targetRef?.name ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>
      ))}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={ep.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={ep.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

function AddressDetailsTab({ resource: ep }: ResourceContext<EndpointsResource>) {
  const subsets = ep.subsets ?? [];

  return (
    <SectionCard title="Address details" icon={Server}>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">IP</th><th className="text-left p-2">Hostname</th><th className="text-left p-2">Node</th><th className="text-left p-2">Target Pod</th><th className="text-left p-2">Ready</th></tr></thead>
          <tbody>
            {subsets.flatMap((s) => (s.addresses ?? []).map((addr) => (
              <tr key={addr.ip} className="border-b">
                <td className="p-2 font-mono">{addr.ip}</td>
                <td className="p-2">{addr.hostname ?? '—'}</td>
                <td className="p-2">{addr.nodeName ?? '—'}</td>
                <td className="p-2">{addr.targetRef?.kind === 'Pod' ? <Link to={`/pods/${addr.targetRef.namespace}/${addr.targetRef.name}`} className="text-primary hover:underline">{addr.targetRef.name}</Link> : '—'}</td>
                <td className="p-2"><Badge variant="default" className="bg-green-600">Ready</Badge></td>
              </tr>
            )))}
            {subsets.flatMap((s) => (s.notReadyAddresses ?? []).map((addr) => (
              <tr key={addr.ip} className="border-b">
                <td className="p-2 font-mono">{addr.ip}</td>
                <td className="p-2">—</td>
                <td className="p-2">—</td>
                <td className="p-2">{addr.targetRef?.kind === 'Pod' ? <Link to={`/pods/${addr.targetRef.namespace}/${addr.targetRef.name}`} className="text-primary hover:underline">{addr.targetRef.name}</Link> : '—'}</td>
                <td className="p-2"><Badge variant="secondary">Not Ready</Badge></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function MetricsTab() {
  return (
    <SectionCard title="Metrics" icon={Activity}>
      <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/30">
        <Info className="h-5 w-5 text-blue-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground/80">Endpoints don't have direct metrics</p>
          <p className="text-xs text-muted-foreground mt-0.5">Endpoints are network address mappings. View metrics on the associated Service or individual Pods instead.</p>
        </div>
      </div>
    </SectionCard>
  );
}

export default function EndpointDetail() {
  const navigate = useNavigate();

  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'addresses', label: 'Address Details', render: (ctx) => <AddressDetailsTab {...ctx} /> },
    { id: 'metrics', label: 'Metrics', render: () => <MetricsTab /> },
  ];

  return (
    <GenericResourceDetail<EndpointsResource>
      resourceType="endpoints"
      kind="Endpoints"
      pluralLabel="Endpoints"
      listPath="/endpoints"
      resourceIcon={Network}
      loadingCardCount={4}
      customTabs={customTabs}
      deriveStatus={(ep) => {
        const readyAddresses = (ep.subsets ?? []).reduce((acc, s) => acc + (s.addresses?.length ?? 0), 0);
        return readyAddresses > 0 ? 'Healthy' : 'Pending';
      }}
      buildStatusCards={(ctx) => {
        const ep = ctx.resource;
        const subsets = ep.subsets ?? [];
        const readyAddresses = subsets.reduce((acc, s) => acc + (s.addresses?.length ?? 0), 0);
        const notReadyAddresses = subsets.reduce((acc, s) => acc + (s.notReadyAddresses?.length ?? 0), 0);
        const totalAddresses = readyAddresses + notReadyAddresses;
        return [
          { label: 'Ready', value: String(readyAddresses), icon: Server, iconColor: 'success' as const },
          { label: 'Not Ready', value: String(notReadyAddresses), icon: Server, iconColor: notReadyAddresses > 0 ? 'warning' as const : 'muted' as const },
          { label: 'Total', value: String(totalAddresses), icon: Network, iconColor: 'info' as const },
          { label: 'Subsets', value: String(subsets.length), icon: Network, iconColor: 'muted' as const },
        ];
      }}
      extraHeaderActions={(ctx) => [
        { label: 'View Service', icon: Globe, variant: 'outline', onClick: () => navigate(`/services/${ctx.namespace}/${ctx.name}`) },
      ]}
      extraActionItems={(ctx) => [
        { icon: Globe, label: 'View Service', description: 'Navigate to the related service', onClick: () => navigate(`/services/${ctx.namespace}/${ctx.name}`) },
      ]}
    />
  );
}
