import { Cpu, Clock, Info } from 'lucide-react';
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

interface K8sDeviceClass extends KubernetesResource {
  spec?: {
    config?: Array<{ opaque?: { driver?: string; parameters?: unknown } }>;
    selectors?: Array<{ cel?: { expression?: string } }>;
    extendedResourceName?: string;
  };
}

function formatSelectors(dc: K8sDeviceClass): string {
  const sel = dc.spec?.selectors;
  if (!sel?.length) return '—';
  return sel.map((s) => s.cel?.expression ?? '—').filter((e) => e !== '—').join('\n\n') || '—';
}

function formatConfig(dc: K8sDeviceClass): string {
  const cfg = dc.spec?.config;
  if (!cfg?.length) return '—';
  return cfg.map((c) => c.opaque?.driver ?? '—').filter((d) => d !== '—').join(', ') || '—';
}

function OverviewTab({ resource: dc, age }: ResourceContext<K8sDeviceClass>) {
  const extendedName = dc?.spec?.extendedResourceName ?? '—';
  const configStr = formatConfig(dc as K8sDeviceClass);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Cpu} title="Device Class Spec" tooltip={<p className="text-xs text-muted-foreground">DRA device presets</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Extended Resource Name" value={<span className="font-mono">{extendedName}</span>} />
          <DetailRow label="Config Drivers" value={<span className="font-mono">{configStr}</span>} />
          <DetailRow label="Age" value={age} />
        </div>
        {dc?.spec?.selectors?.length ? (
          <div className="mt-4">
            <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">CEL Selectors</span>
            <div className="mt-2 space-y-2">
              {dc.spec.selectors.map((s, i) => (
                <pre key={i} className="p-3 rounded-lg bg-muted/50 text-xs font-mono overflow-x-auto">{s.cel?.expression ?? '—'}</pre>
              ))}
            </div>
          </div>
        ) : null}
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={dc?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={dc?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function DeviceClassDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sDeviceClass>
      resourceType="deviceclasses"
      kind="DeviceClass"
      pluralLabel="Device Classes"
      listPath="/deviceclasses"
      resourceIcon={Cpu}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const dc = ctx.resource;
        const extendedName = dc?.spec?.extendedResourceName ?? '—';
        const configStr = formatConfig(dc as K8sDeviceClass);
        const selectorsStr = formatSelectors(dc as K8sDeviceClass);

        return [
          { label: 'Extended Resource', value: extendedName, icon: Cpu, iconColor: 'primary' as const },
          { label: 'Config Drivers', value: configStr, icon: Cpu, iconColor: 'info' as const },
          { label: 'Selectors', value: selectorsStr.length > 40 ? `${selectorsStr.slice(0, 37)}…` : selectorsStr, icon: Cpu, iconColor: 'muted' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
