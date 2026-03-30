import { Scale, Cpu, HardDrive, Sliders, List } from 'lucide-react';
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

interface LimitRangeItemSpec {
  type: string;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  min?: Record<string, string>;
  max?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
}

interface LimitRangeResource extends KubernetesResource {
  spec?: { limits?: LimitRangeItemSpec[] };
}

// ---------------------------------------------------------------------------
// Custom tab components
// ---------------------------------------------------------------------------

function OverviewTab({ resource }: ResourceContext<LimitRangeResource>) {
  const limits = resource?.spec?.limits ?? [];
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  return (
    <div className="space-y-6">
      {limits.map((limit, idx) => (
        <SectionCard key={idx} icon={Sliders} title={`${limit.type} Limits`}>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              {limit.default && Object.entries(limit.default).map(([k, v]) => (
                <DetailRow key={`default-${k}`} label={`Default ${k}`} value={<span className="font-mono">{v}</span>} />
              ))}
              {limit.defaultRequest && Object.entries(limit.defaultRequest).map(([k, v]) => (
                <DetailRow key={`defaultReq-${k}`} label={`Default Request ${k}`} value={<span className="font-mono">{v}</span>} />
              ))}
              {limit.max && Object.entries(limit.max).map(([k, v]) => (
                <DetailRow key={`max-${k}`} label={`Max ${k}`} value={<span className="font-mono">{v}</span>} />
              ))}
              {limit.min && Object.entries(limit.min).map(([k, v]) => (
                <DetailRow key={`min-${k}`} label={`Min ${k}`} value={<span className="font-mono">{v}</span>} />
              ))}
              {limit.maxLimitRequestRatio && Object.entries(limit.maxLimitRequestRatio).map(([k, v]) => (
                <DetailRow key={`ratio-${k}`} label={`Max Limit/Request Ratio ${k}`} value={<span className="font-mono">{v}</span>} />
              ))}
            </div>
        </SectionCard>
      ))}
      {limits.length === 0 && <p className="text-muted-foreground text-sm">No limits defined.</p>}
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

function LimitDetailsTab() {
  return (
    <SectionCard icon={List} title="Per-Type Limits">
        <p className="text-muted-foreground text-sm">Same as Overview — limits array with default, defaultRequest, min, max per type (Container, Pod, PVC).</p>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function LimitRangeDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'limit-details', label: 'Limit Details', render: () => <LimitDetailsTab /> },
  ];

  return (
    <GenericResourceDetail<LimitRangeResource>
      resourceType="limitranges"
      kind="LimitRange"
      pluralLabel="Limit Ranges"
      listPath="/limitranges"
      resourceIcon={Scale}
      loadingCardCount={4}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const limits = ctx.resource?.spec?.limits ?? [];
        const containerLimit = limits.find((l) => l.type === 'Container');
        const defaultCpu = containerLimit?.default?.cpu ?? containerLimit?.defaultRequest?.cpu ?? '–';
        const defaultMemory = containerLimit?.default?.memory ?? containerLimit?.defaultRequest?.memory ?? '–';
        const maxCpu = containerLimit?.max?.cpu ?? limits.find((l) => l.type === 'Pod')?.max?.cpu ?? '–';

        return [
          { label: 'Types Covered', value: limits.length, icon: Scale, iconColor: 'primary' as const },
          { label: 'Default CPU', value: defaultCpu, icon: Cpu, iconColor: 'muted' as const },
          { label: 'Default Memory', value: defaultMemory, icon: HardDrive, iconColor: 'muted' as const },
          { label: 'Max CPU', value: maxCpu, icon: Cpu, iconColor: 'info' as const },
        ];
      }}
    />
  );
}
