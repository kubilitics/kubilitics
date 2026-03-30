import { Layers, Info } from 'lucide-react';
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

interface K8sPodTemplate extends KubernetesResource {
  template?: {
    metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
    spec?: { containers?: Array<{ name: string; image?: string }> };
  };
}

function OverviewTab({ resource: pt, age, namespace }: ResourceContext<K8sPodTemplate>) {
  const ptName = pt?.metadata?.name ?? '';
  const ptNamespace = pt?.metadata?.namespace ?? namespace ?? '';
  const template = pt?.template ?? {};
  const labels = template.metadata?.labels ?? pt?.metadata?.labels ?? {};
  const containers = template.spec?.containers ?? [];

  return (
    <div className="space-y-6">
      <SectionCard icon={Info} title="Overview">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Name" value={ptName} />
          <DetailRow label="Namespace" value={ptNamespace} />
          <DetailRow label="Age" value={age} />
          <DetailRow label="Containers" value={containers.length > 0 ? String(containers.length) : '0'} />
        </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={labels} title="Template Labels" />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={pt?.metadata?.annotations ?? {}} />
      </div>
      {containers.length > 0 && (
        <SectionCard icon={Layers} title="Containers" tooltip={<p className="text-xs text-muted-foreground">Containers in the pod template spec</p>}>
          <div className="space-y-2">
            {containers.map((c, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                <span className="font-mono text-sm">{c.name}</span>
                <span className="text-muted-foreground text-sm">{(c as { image?: string }).image ?? '—'}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

export default function PodTemplateDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sPodTemplate>
      resourceType="podtemplates"
      kind="PodTemplate"
      pluralLabel="Pod Templates"
      listPath="/podtemplates"
      resourceIcon={Layers}
      loadingCardCount={3}
      customTabs={customTabs}
      deriveStatus={() => 'Healthy'}
      buildStatusCards={(ctx) => {
        const pt = ctx.resource;
        const ptNamespace = pt?.metadata?.namespace ?? ctx.namespace;
        const template = pt?.template ?? {};
        const labels = template.metadata?.labels ?? pt?.metadata?.labels ?? {};
        const containers = template.spec?.containers ?? [];

        return [
          { label: 'Namespace', value: ptNamespace, icon: Layers, iconColor: 'primary' as const },
          { label: 'Labels', value: Object.keys(labels).length > 0 ? `${Object.keys(labels).length} labels` : 'None', icon: Layers, iconColor: 'info' as const },
          { label: 'Containers', value: containers.length > 0 ? String(containers.length) : '0', icon: Layers, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
