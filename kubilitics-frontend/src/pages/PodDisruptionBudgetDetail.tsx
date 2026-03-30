import { Shield, Clock, Server, AlertTriangle, Settings, Activity, Target } from 'lucide-react';
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

interface PDBResource extends KubernetesResource {
  spec?: {
    minAvailable?: number | string;
    maxUnavailable?: number | string;
    selector?: { matchLabels?: Record<string, string> };
  };
  status?: {
    currentHealthy?: number;
    desiredHealthy?: number;
    disruptionsAllowed?: number;
    expectedPods?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

// ---------------------------------------------------------------------------
// Custom tab components
// ---------------------------------------------------------------------------

function OverviewTab({ resource }: ResourceContext<PDBResource>) {
  const minAvailable = resource?.spec?.minAvailable;
  const maxUnavailable = resource?.spec?.maxUnavailable;
  const selector = resource?.spec?.selector?.matchLabels ?? {};
  const currentHealthy = resource?.status?.currentHealthy ?? 0;
  const desiredHealthy = resource?.status?.desiredHealthy ?? 0;
  const disruptionsAllowed = resource?.status?.disruptionsAllowed ?? 0;
  const expectedPods = resource?.status?.expectedPods ?? 0;
  const conditions = resource?.status?.conditions ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Settings} title="Budget Configuration">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Min Available" value={minAvailable != null && minAvailable !== '' ? String(minAvailable) : '–'} />
            <DetailRow label="Max Unavailable" value={maxUnavailable != null && maxUnavailable !== '' ? String(maxUnavailable) : '–'} />
          </div>
      </SectionCard>
      <SectionCard icon={Activity} title="Current Status">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Expected / Desired" value={<span className="font-semibold">{expectedPods > 0 ? expectedPods : desiredHealthy}</span>} />
            <DetailRow label="Healthy" value={<span className="font-semibold text-[hsl(var(--success))]">{currentHealthy}</span>} />
            <DetailRow label="Disruptions Allowed" value={<span className="font-semibold text-primary">{disruptionsAllowed}</span>} />
          </div>
      </SectionCard>
      <SectionCard icon={Target} title="Pod Selector">
          {Object.keys(selector).length === 0 ? (
            <p className="text-muted-foreground text-sm">No selector.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(selector).map(([k, v]) => (
                <Badge key={k} variant="outline" className="font-mono text-xs">{k}={v}</Badge>
              ))}
            </div>
          )}
      </SectionCard>
      <SectionCard icon={AlertTriangle} title="Conditions">
          {conditions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No conditions.</p>
          ) : (
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="font-medium">{c.type}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === 'True' ? 'default' : 'secondary'}>{c.status}</Badge>
                    {c.reason && <span className="text-sm text-muted-foreground">{c.reason}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={labels} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={annotations} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PodDisruptionBudgetDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<PDBResource>
      resourceType="poddisruptionbudgets"
      kind="PodDisruptionBudget"
      pluralLabel="PDBs"
      listPath="/poddisruptionbudgets"
      resourceIcon={Shield}
      loadingCardCount={4}
      customTabs={customTabs}
      deriveStatus={(resource) => {
        const disruptionsAllowed = resource?.status?.disruptionsAllowed ?? 0;
        const currentHealthy = resource?.status?.currentHealthy ?? 0;
        const desiredHealthy = resource?.status?.desiredHealthy ?? 0;
        return disruptionsAllowed > 0 || currentHealthy >= desiredHealthy ? 'Healthy' : 'Warning';
      }}
      buildStatusCards={(ctx) => {
        const resource = ctx.resource;
        const minAvailable = resource?.spec?.minAvailable;
        const currentHealthy = resource?.status?.currentHealthy ?? 0;
        const desiredHealthy = resource?.status?.desiredHealthy ?? 0;
        const disruptionsAllowed = resource?.status?.disruptionsAllowed ?? 0;
        const expectedPods = resource?.status?.expectedPods ?? 0;

        return [
          { label: 'Min Available', value: minAvailable != null && minAvailable !== '' ? String(minAvailable) : '–', icon: Server, iconColor: 'primary' as const },
          { label: 'Healthy Pods', value: `${currentHealthy}/${expectedPods > 0 ? expectedPods : desiredHealthy}`, icon: Server, iconColor: 'success' as const },
          { label: 'Disruptions Allowed', value: disruptionsAllowed, icon: AlertTriangle, iconColor: disruptionsAllowed > 0 ? 'info' as const : 'warning' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
