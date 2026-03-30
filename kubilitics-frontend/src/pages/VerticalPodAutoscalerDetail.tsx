import { useNavigate } from 'react-router-dom';
import { Scale, Clock, Cpu, MemoryStick, TrendingUp, Target, Activity } from 'lucide-react';
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

interface VPAResource extends KubernetesResource {
  spec?: {
    targetRef?: { kind?: string; name?: string; apiVersion?: string };
    updatePolicy?: { updateMode?: string };
    resourcePolicy?: { containerPolicies?: Array<{ containerName?: string }> };
  };
  status?: {
    recommendation?: {
      containerRecommendations?: Array<{
        containerName?: string;
        lowerBound?: Record<string, string>;
        target?: Record<string, string>;
        upperBound?: Record<string, string>;
        uncappedTarget?: Record<string, string>;
      }>;
    };
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

function OverviewTab({ resource, namespace }: ResourceContext<VPAResource>) {
  const navigate = useNavigate();
  const ref = resource?.spec?.targetRef;
  const targetKind = ref?.kind ?? '–';
  const targetName = ref?.name ?? '–';
  const updateMode = resource?.spec?.updatePolicy?.updateMode ?? 'Auto';
  const recommendations = resource?.status?.recommendation?.containerRecommendations ?? [];
  const conditions = resource?.status?.conditions ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  const targetLink = () => {
    const kind = (targetKind || '').toLowerCase();
    if (kind === 'deployment') return `/deployments/${namespace}/${targetName}`;
    if (kind === 'statefulset') return `/statefulsets/${namespace}/${targetName}`;
    return '#';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Target} title="Target Reference">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Reference" value={targetName !== '–' ? (
              <Button variant="link" className="p-0 h-auto font-mono text-primary" onClick={() => navigate(targetLink())}>{targetKind}/{targetName}</Button>
            ) : '–'} />
            <DetailRow label="Update Mode" value={<Badge variant={updateMode === 'Auto' ? 'default' : 'secondary'}>{updateMode}</Badge>} />
          </div>
      </SectionCard>
      <SectionCard icon={TrendingUp} title="Recommendations">
          {recommendations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No recommendations yet.</p>
          ) : (
            recommendations.map((cr) => (
              <div key={cr.containerName ?? 'default'} className="space-y-3">
                <p className="font-medium">{cr.containerName ?? 'default'}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-xs text-muted-foreground">CPU Target</p>
                    <p className="font-mono">{cr.target?.cpu ?? '–'}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-xs text-muted-foreground">Memory Target</p>
                    <p className="font-mono">{cr.target?.memory ?? '–'}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-xs text-muted-foreground">CPU Range</p>
                    <p className="font-mono text-sm">{cr.lowerBound?.cpu ?? '–'} – {cr.upperBound?.cpu ?? '–'}</p>
                  </div>
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-xs text-muted-foreground">Memory Range</p>
                    <p className="font-mono text-sm">{cr.lowerBound?.memory ?? '–'} – {cr.upperBound?.memory ?? '–'}</p>
                  </div>
                </div>
              </div>
            ))
          )}
      </SectionCard>
      <SectionCard icon={Activity} title="Conditions" className="lg:col-span-2">
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

function RecommendationsTab({ resource }: ResourceContext<VPAResource>) {
  const recommendations = resource?.status?.recommendation?.containerRecommendations ?? [];

  return (
    <SectionCard icon={Cpu} title="Container Recommendations">
        {recommendations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recommendations available.</p>
        ) : (
          <div className="space-y-4">
            {recommendations.map((cr) => (
              <div key={cr.containerName ?? 'default'} className="p-4 rounded-lg border bg-muted/30 space-y-2">
                <p className="font-medium">{cr.containerName ?? 'default'}</p>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Lower:</span> <span className="font-mono">{cr.lowerBound?.cpu ?? '–'} / {cr.lowerBound?.memory ?? '–'}</span></div>
                  <div><span className="text-muted-foreground">Target:</span> <span className="font-mono">{cr.target?.cpu ?? '–'} / {cr.target?.memory ?? '–'}</span></div>
                  <div><span className="text-muted-foreground">Upper:</span> <span className="font-mono">{cr.upperBound?.cpu ?? '–'} / {cr.upperBound?.memory ?? '–'}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
    </SectionCard>
  );
}

export default function VerticalPodAutoscalerDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'recommendations', label: 'Recommendations', render: (ctx) => <RecommendationsTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<VPAResource>
      resourceType="verticalpodautoscalers"
      kind="VerticalPodAutoscaler"
      pluralLabel="VPAs"
      listPath="/verticalpodautoscalers"
      resourceIcon={Scale}
      customTabs={customTabs}
      deriveStatus={(resource) => {
        const recommendations = resource?.status?.recommendation?.containerRecommendations ?? [];
        return recommendations.length > 0 ? 'Healthy' : 'Progressing';
      }}
      buildStatusCards={(ctx) => {
        const resource = ctx.resource;
        const updateMode = resource?.spec?.updatePolicy?.updateMode ?? 'Auto';
        const firstRec = (resource?.status?.recommendation?.containerRecommendations ?? [])[0];

        return [
          { label: 'Update Mode', value: updateMode, icon: TrendingUp, iconColor: 'primary' as const },
          { label: 'Target CPU', value: firstRec?.target?.cpu ?? '–', icon: Cpu, iconColor: 'info' as const },
          { label: 'Target Memory', value: firstRec?.target?.memory ?? '–', icon: MemoryStick, iconColor: 'success' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
