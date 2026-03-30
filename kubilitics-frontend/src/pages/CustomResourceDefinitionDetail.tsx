import { FileCode, Clock, Layers, Package, Info, Activity } from 'lucide-react';
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

interface CRDResource extends KubernetesResource {
  spec?: {
    group: string;
    names: { kind: string; plural: string; singular: string; shortNames?: string[] };
    scope: string;
    versions: Array<{ name: string; served: boolean; storage: boolean }>;
  };
  status?: {
    conditions?: Array<{ type: string; status: string; reason: string; message?: string }>;
  };
}

function OverviewTab({ resource: crd, age }: ResourceContext<CRDResource>) {
  const spec = crd?.spec;
  const status = crd?.status;
  const group = spec?.group ?? '-';
  const scope = spec?.scope ?? '-';
  const kind = spec?.names?.kind ?? '-';
  const plural = spec?.names?.plural ?? '-';
  const singular = spec?.names?.singular ?? '-';
  const shortNames = spec?.names?.shortNames ?? [];
  const versions = spec?.versions ?? [];
  const conditions = status?.conditions ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Info} title="CRD Info">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="Group" value={<span className="font-mono">{group}</span>} />
            <DetailRow label="Kind" value={<Badge variant="default">{kind}</Badge>} />
            <DetailRow label="Plural" value={<span className="font-mono">{plural}</span>} />
            <DetailRow label="Singular" value={<span className="font-mono">{singular}</span>} />
            <DetailRow label="Scope" value={<Badge variant="outline">{scope}</Badge>} />
            <DetailRow label="Short Names" value={
              shortNames.length > 0 ? (
                <div className="flex gap-1 flex-wrap">
                  {shortNames.map((sn) => (
                    <Badge key={sn} variant="secondary" className="font-mono text-xs">{sn}</Badge>
                  ))}
                </div>
              ) : '–'
            } />
            <DetailRow label="Age" value={age} />
          </div>
      </SectionCard>
      <SectionCard icon={Layers} title="Versions">
          <div className="space-y-2">
            {versions.map((ver) => (
              <div key={ver.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Badge variant={ver.storage ? 'default' : 'secondary'}>{ver.name}</Badge>
                  {ver.storage && <Badge variant="outline" className="text-xs">Storage</Badge>}
                </div>
                <Badge variant={ver.served ? 'default' : 'secondary'}>
                  {ver.served ? 'Served' : 'Not Served'}
                </Badge>
              </div>
            ))}
          </div>
      </SectionCard>
      <SectionCard icon={Activity} title="Conditions">
          <div className="space-y-2">
            {conditions.map((condition) => (
              <div key={condition.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <Badge variant={condition.status === 'True' ? 'default' : 'secondary'}>
                  {condition.type}
                </Badge>
                <span className="text-sm text-muted-foreground">{condition.reason}</span>
              </div>
            ))}
            {conditions.length === 0 && <p className="text-sm text-muted-foreground">No conditions</p>}
          </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={crd?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={crd?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
];

export default function CustomResourceDefinitionDetail() {
  return (
    <GenericResourceDetail<CRDResource>
      resourceType="customresourcedefinitions"
      kind="CustomResourceDefinition"
      pluralLabel="Custom Resource Definitions"
      listPath="/customresourcedefinitions"
      resourceIcon={FileCode}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const spec = ctx.resource?.spec;
        const group = spec?.group ?? '-';
        const scope = spec?.scope ?? '-';
        const versions = spec?.versions ?? [];
        return [
          { label: 'Group', value: group, icon: Package, iconColor: 'primary' as const },
          { label: 'Versions', value: versions.length, icon: Layers, iconColor: 'info' as const },
          { label: 'Scope', value: scope, icon: FileCode, iconColor: 'success' as const },
          { label: 'Age', value: ctx.age || '-', icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
