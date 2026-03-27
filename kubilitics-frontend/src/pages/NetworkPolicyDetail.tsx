import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Shield, Download, ArrowDownToLine, ArrowUpFromLine, Activity } from 'lucide-react';
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
import { useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';
import { toast } from '@/components/ui/sonner';

interface NetworkPolicyResource extends KubernetesResource {
  spec?: {
    podSelector?: { matchLabels?: Record<string, string>; matchExpressions?: unknown[] };
    policyTypes?: string[];
    ingress?: Array<{
      from?: Array<{ podSelector?: { matchLabels?: Record<string, string> }; namespaceSelector?: { matchLabels?: Record<string, string> }; ipBlock?: { cidr: string } }>;
      ports?: Array<{ protocol?: string; port?: number | string }>;
    }>;
    egress?: Array<{
      to?: Array<{ podSelector?: { matchLabels?: Record<string, string> }; namespaceSelector?: { matchLabels?: Record<string, string> }; ipBlock?: { cidr: string } }>;
      ports?: Array<{ protocol?: string; port?: number | string }>;
    }>;
  };
}

function useAffectedPods(namespace: string, podSelector: Record<string, string>) {
  const podsInNs = useK8sResourceList<KubernetesResource>('pods', namespace, { enabled: !!namespace });
  return useMemo(() => {
    if (!podsInNs.data?.items?.length || !Object.keys(podSelector).length) return [];
    return (podsInNs.data.items as KubernetesResource[]).filter((p) => {
      const labels = p.metadata?.labels ?? {};
      return Object.entries(podSelector).every(([k, v]) => labels[k] === v);
    });
  }, [podsInNs.data?.items, podSelector]);
}

function OverviewTab({ resource: np, age }: ResourceContext<NetworkPolicyResource>) {
  const namespace = np.metadata?.namespace ?? '';
  const podSelector = np.spec?.podSelector?.matchLabels ?? {};
  const policyTypes = np.spec?.policyTypes ?? [];
  const ingressRules = np.spec?.ingress ?? [];
  const egressRules = np.spec?.egress ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Pod Selector" icon={Shield}>
          {Object.keys(podSelector).length === 0 ? <p className="text-muted-foreground text-sm">All pods in namespace</p> : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(podSelector).map(([key, value]) => (
                <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Policy Info" icon={Shield}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Policy Types" value={
              <div className="flex gap-2 flex-wrap">
                {policyTypes.map((type) => (
                  <Badge key={type} variant="secondary">{type}</Badge>
                ))}
              </div>
            } />
            <DetailRow label="Namespace" value={namespace} />
            <DetailRow label="Age" value={age} />
          </div>
        </SectionCard>
      </div>
      {ingressRules.length > 0 && (
        <SectionCard title="Ingress Rules" icon={ArrowDownToLine}>
            {ingressRules.map((rule, idx) => (
              <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3 mb-3 last:mb-0">
                <div>
                  <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-2">From</p>
                  <div className="space-y-2">
                    {(rule.from ?? []).map((source, sIdx) => (
                      <div key={sIdx} className="flex gap-2 flex-wrap">
                        {source.podSelector?.matchLabels && (
                          <Badge variant="outline" className="font-mono text-xs">
                            Pod: {Object.entries(source.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}
                          </Badge>
                        )}
                        {source.namespaceSelector?.matchLabels && (
                          <Badge variant="secondary" className="font-mono text-xs">
                            Namespace: {Object.entries(source.namespaceSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}
                          </Badge>
                        )}
                        {source.ipBlock?.cidr && (
                          <Badge variant="outline" className="font-mono text-xs">IP: {source.ipBlock.cidr}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-2">Ports</p>
                  <div className="flex gap-2 flex-wrap">
                    {(rule.ports ?? []).map((port, pIdx) => (
                      <Badge key={pIdx} variant="outline" className="font-mono text-xs">
                        {port.port}/{port.protocol ?? 'TCP'}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
        </SectionCard>
      )}
      {egressRules.length > 0 && (
        <SectionCard title="Egress Rules" icon={ArrowUpFromLine}>
            {egressRules.map((rule, idx) => (
              <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3 mb-3 last:mb-0">
                <div>
                  <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-2">To</p>
                  <div className="space-y-2">
                    {(rule.to ?? []).map((dest, dIdx) => (
                      <div key={dIdx} className="flex gap-2 flex-wrap">
                        {dest.podSelector?.matchLabels && <Badge variant="outline" className="font-mono text-xs">Pod: {Object.entries(dest.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}</Badge>}
                        {dest.namespaceSelector?.matchLabels && <Badge variant="secondary" className="font-mono text-xs">Namespace: {Object.entries(dest.namespaceSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')}</Badge>}
                        {dest.ipBlock?.cidr && <Badge variant="outline" className="font-mono text-xs">IP: {dest.ipBlock.cidr}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider mb-2">Ports</p>
                  <div className="flex gap-2 flex-wrap">
                    {(rule.ports ?? []).map((port, pIdx) => (
                      <Badge key={pIdx} variant="outline" className="font-mono text-xs">{port.port}/{port.protocol ?? 'TCP'}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={np.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={np.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

function VisualizationTab({ resource: np }: ResourceContext<NetworkPolicyResource>) {
  const namespace = np.metadata?.namespace ?? '';
  const podSelector = np.spec?.podSelector?.matchLabels ?? {};
  const affectedPods = useAffectedPods(namespace, podSelector);
  const ingressRules = np.spec?.ingress ?? [];
  const egressRules = np.spec?.egress ?? [];

  return (
    <SectionCard title="Policy visualization" icon={Shield}>
      <p className="text-muted-foreground text-sm mb-4">Diagram: selected pods, allowed ingress/egress sources/destinations. Simplified view.</p>
      <p className="text-sm">Selected pods: {affectedPods.length}. Ingress rules: {ingressRules.length}. Egress rules: {egressRules.length}.</p>
    </SectionCard>
  );
}

function SimulationTab() {
  return (
    <SectionCard title="Policy simulation" icon={Shield}>
      <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50/50 border border-amber-200/50 dark:bg-amber-950/10 dark:border-amber-800/30">
        <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Coming Soon</p>
          <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">Policy simulation will allow you to test traffic flow against this network policy by specifying source and destination pods, namespaces, or IP addresses. This feature requires backend support and is planned for a future release.</p>
        </div>
      </div>
    </SectionCard>
  );
}

function AffectedPodsTab({ resource: np }: ResourceContext<NetworkPolicyResource>) {
  const namespace = np.metadata?.namespace ?? '';
  const podSelector = np.spec?.podSelector?.matchLabels ?? {};
  const affectedPods = useAffectedPods(namespace, podSelector);

  return (
    <SectionCard title="Affected pods" icon={Shield}>
      {affectedPods.length === 0 ? <p className="text-muted-foreground text-sm">No pods match the pod selector.</p> : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Name</th><th className="text-left p-2">Actions</th></tr></thead>
            <tbody>
              {affectedPods.map((p) => (
                <tr key={p.metadata?.name} className="border-b">
                  <td className="p-2 font-mono">{p.metadata?.name}</td>
                  <td className="p-2"><Link to={`/pods/${namespace}/${p.metadata?.name}`} className="text-primary text-sm hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function CoverageTab() {
  return (
    <SectionCard title="Coverage analysis" icon={Shield}>
      <p className="text-muted-foreground text-sm">Namespace coverage %, uncovered pods list, default-deny status. Placeholder for full analysis.</p>
    </SectionCard>
  );
}

function MetricsTab() {
  return (
    <SectionCard title="Metrics" icon={Activity}>
      <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border/50">
        <Activity className="h-5 w-5 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">Metrics require a metrics server</p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">Install a metrics pipeline (e.g. Prometheus + kube-prometheus-stack) in your cluster to view resource metrics here.</p>
        </div>
      </div>
    </SectionCard>
  );
}

function AuditTab() {
  return (
    <SectionCard title="Audit trail" icon={Shield}>
      <p className="text-muted-foreground text-sm">Placeholder for event history / audit.</p>
    </SectionCard>
  );
}

export default function NetworkPolicyDetail() {
  const { namespace: nsParam } = useParams();
  const namespace = nsParam ?? '';

  // Fetch affected pods at the top level so we can use the count in status cards
  const podsInNs = useK8sResourceList<KubernetesResource>('pods', namespace, { enabled: !!namespace });

  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'visualization', label: 'Policy Visualization', render: (ctx) => <VisualizationTab {...ctx} /> },
    { id: 'simulation', label: 'Policy Simulation', render: () => <SimulationTab /> },
    { id: 'pods', label: 'Affected Pods', render: (ctx) => <AffectedPodsTab {...ctx} /> },
    { id: 'coverage', label: 'Coverage Analysis', render: () => <CoverageTab /> },
    { id: 'metrics', label: 'Metrics', render: () => <MetricsTab /> },
    { id: 'audit', label: 'Audit Trail', render: () => <AuditTab /> },
  ];

  return (
    <GenericResourceDetail<NetworkPolicyResource>
      resourceType="networkpolicies"
      kind="NetworkPolicy"
      pluralLabel="Network Policies"
      listPath="/networkpolicies"
      resourceIcon={Shield}
      loadingCardCount={5}
      customTabs={customTabs}
      deriveStatus={() => 'Healthy'}
      buildStatusCards={(ctx) => {
        const np = ctx.resource;
        const podSelector = np.spec?.podSelector?.matchLabels ?? {};
        const policyTypes = np.spec?.policyTypes ?? [];
        const ingressRules = np.spec?.ingress ?? [];
        const egressRules = np.spec?.egress ?? [];

        // Compute affected pods count from the pre-fetched list
        const podItems = podsInNs.data?.items ?? [];
        const affectedCount = Object.keys(podSelector).length === 0 ? 0 :
          podItems.filter((p: KubernetesResource) => {
            const labels = p.metadata?.labels ?? {};
            return Object.entries(podSelector).every(([k, v]) => labels[k] === v);
          }).length;

        return [
          { label: 'Policy Types', value: policyTypes.join(', ') || '—', icon: Shield, iconColor: 'primary' as const },
          { label: 'Affected Pods', value: String(affectedCount), icon: Shield, iconColor: 'info' as const },
          { label: 'Ingress Rules', value: String(ingressRules.length), icon: ArrowDownToLine, iconColor: 'info' as const },
          { label: 'Egress Rules', value: String(egressRules.length), icon: ArrowUpFromLine, iconColor: 'muted' as const },
          { label: 'Namespace', value: ctx.namespace, icon: Shield, iconColor: 'muted' as const },
        ];
      }}
      extraActionItems={() => [
        { icon: Shield, label: 'Simulate', description: 'Run policy simulation', onClick: () => toast.info('Simulation: requires backend support (design 3.6)') },
        { icon: Download, label: 'Clone policy', description: 'Create a copy', onClick: () => toast.info('Clone: open create with same YAML') },
      ]}
    />
  );
}
