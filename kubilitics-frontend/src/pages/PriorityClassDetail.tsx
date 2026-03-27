import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpDown, Shield, Info, FileText, Scale, Server } from 'lucide-react';
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

interface PriorityClassResource extends KubernetesResource {
  value?: number;
  globalDefault?: boolean;
  preemptionPolicy?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Custom tab components
// ---------------------------------------------------------------------------

function OverviewTab({ resource, age }: ResourceContext<PriorityClassResource>) {
  const value = typeof resource?.value === 'number' ? resource.value : 0;
  const globalDefault = !!resource?.globalDefault;
  const preemptionPolicy = resource?.preemptionPolicy ?? 'PreemptLowerPriority';
  const description = resource?.description ?? '';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Info} title="Priority Class Info">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Priority Value" value={<span className="font-mono text-primary">{value.toLocaleString()}</span>} />
              <DetailRow label="Global Default" value={<Badge variant={globalDefault ? 'default' : 'secondary'}>{globalDefault ? 'Yes' : 'No'}</Badge>} />
              <DetailRow label="Preemption Policy" value={<Badge variant="outline">{preemptionPolicy}</Badge>} />
              <DetailRow label="Age" value={age} />
            </div>
        </SectionCard>
        <SectionCard icon={FileText} title="Description">
            <p className="text-sm text-muted-foreground">{description || '–'}</p>
        </SectionCard>
        <SectionCard icon={Scale} title="Priority Scale" className="lg:col-span-2">
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
        </SectionCard>
      </div>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={resource?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={resource?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

function PodDistributionTab({ resource }: ResourceContext<PriorityClassResource>) {
  const navigate = useNavigate();
  const pcName = resource?.metadata?.name ?? '';

  return (
    <SectionCard icon={Server} title="Pods Using This Priority Class">
        <p className="text-muted-foreground text-sm">Pods with <code>spec.priorityClassName: {pcName}</code> can be listed by viewing Pods and filtering by priority class.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate('/pods')}>View Pods</Button>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PriorityClassDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'pod-distribution', label: 'Pod Distribution', render: (ctx) => <PodDistributionTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<PriorityClassResource>
      resourceType="priorityclasses"
      kind="PriorityClass"
      pluralLabel="Priority Classes"
      listPath="/priorityclasses"
      resourceIcon={AlertTriangle}
      loadingCardCount={4}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const resource = ctx.resource;
        const value = typeof resource?.value === 'number' ? resource.value : 0;
        const globalDefault = !!resource?.globalDefault;
        const preemptionPolicy = resource?.preemptionPolicy ?? 'PreemptLowerPriority';

        return [
          { label: 'Value', value: value.toLocaleString(), icon: ArrowUpDown, iconColor: 'primary' as const },
          { label: 'Global Default', value: globalDefault ? 'Yes' : 'No', icon: Shield, iconColor: 'info' as const },
          { label: 'Preemption Policy', value: preemptionPolicy, icon: AlertTriangle, iconColor: 'muted' as const },
          { label: 'Pods Using', value: '–', icon: AlertTriangle, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
