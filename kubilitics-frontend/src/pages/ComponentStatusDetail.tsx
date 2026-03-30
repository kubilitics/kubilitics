import { Activity, Clock, CheckCircle, AlertTriangle, Server, Info } from 'lucide-react';
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

interface ComponentStatusResource extends KubernetesResource {
  conditions?: Array<{
    type: string;
    status: string;
    message?: string;
    error?: string;
  }>;
}

function OverviewTab({ resource: cs, age }: ResourceContext<ComponentStatusResource>) {
  const csName = cs?.metadata?.name || '';
  const conditions = cs?.conditions ?? [];
  const isHealthy = conditions.some(c => c.type === 'Healthy' && c.status === 'True');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Info} title="Component Info">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Component" value={csName} />
            <DetailRow label="Status" value={
              <Badge variant={isHealthy ? 'default' : 'destructive'}>
                {isHealthy ? 'Healthy' : 'Unhealthy'}
              </Badge>
            } />
            <DetailRow label="Description" value={
              isHealthy ? 'Component is healthy and responding normally' : 'Component is experiencing issues'
            } />
            <DetailRow label="Age" value={age} />
          </div>
      </SectionCard>
      <SectionCard icon={Activity} title="Conditions" className="lg:col-span-2">
          {conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conditions reported.</p>
          ) : (
            <div className="space-y-3">
              {conditions.map((condition, idx) => (
                <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant={condition.status === 'True' ? 'default' : 'destructive'}>
                      {condition.type}
                    </Badge>
                    <Badge variant="outline">{condition.status}</Badge>
                  </div>
                  {condition.message && (
                    <p className="text-sm font-mono text-muted-foreground break-all">
                      {condition.message}
                    </p>
                  )}
                  {condition.error && (
                    <p className="text-sm text-destructive">
                      Error: {condition.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={cs?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={cs?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function ComponentStatusDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<ComponentStatusResource>
      resourceType="componentstatuses"
      kind="ComponentStatus"
      pluralLabel="Component Statuses"
      listPath="/componentstatuses"
      resourceIcon={Activity}
      customTabs={customTabs}
      deriveStatus={(cs) => {
        const conditions = cs?.conditions ?? [];
        const isHealthy = conditions.some(c => c.type === 'Healthy' && c.status === 'True');
        return isHealthy ? 'Healthy' : 'Unhealthy';
      }}
      buildStatusCards={(ctx) => {
        const cs = ctx.resource;
        const csName = cs?.metadata?.name || '';
        const conditions = cs?.conditions ?? [];
        const isHealthy = conditions.some(c => c.type === 'Healthy' && c.status === 'True');

        return [
          { label: 'Status', value: isHealthy ? 'Healthy' : 'Unhealthy', icon: isHealthy ? CheckCircle : AlertTriangle, iconColor: isHealthy ? 'success' as const : 'error' as const },
          { label: 'Component', value: csName, icon: Server, iconColor: 'primary' as const },
          { label: 'Conditions', value: conditions.length, icon: Activity, iconColor: 'info' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
