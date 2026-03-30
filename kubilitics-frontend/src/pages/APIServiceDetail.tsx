import { FileCode, Clock, Server, CheckCircle, Info } from 'lucide-react';
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

interface APIServiceResource extends KubernetesResource {
  metadata: KubernetesResource['metadata'] & {
    ownerReferences?: Array<{ kind: string; name: string }>;
  };
  spec?: {
    service?: { namespace?: string; name?: string };
    group?: string;
    version?: string;
    insecureSkipTLSVerify?: boolean;
    groupPriorityMinimum?: number;
    versionPriority?: number;
  };
  status?: {
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
}

function OverviewTab({ resource: api, age }: ResourceContext<APIServiceResource>) {
  const group = api?.spec?.group ?? '–';
  const version = api?.spec?.version ?? '–';
  const serviceRef = api?.spec?.service
    ? `${api.spec.service.namespace}/${api.spec.service.name}`
    : 'Local';
  const conditions = api?.status?.conditions ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={FileCode} title="API Service Info" tooltip="Group, version, service reference">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Group" value={<span className="font-mono">{group}</span>} />
          <DetailRow label="Version" value={<Badge variant="secondary">{version}</Badge>} />
          <DetailRow label="Service" value={serviceRef} />
          <DetailRow label="Insecure Skip TLS" value={api?.spec?.insecureSkipTLSVerify ? 'Yes' : 'No'} />
          <DetailRow label="Group Priority Minimum" value={<span className="font-mono">{api?.spec?.groupPriorityMinimum ?? '–'}</span>} />
          <DetailRow label="Version Priority" value={<span className="font-mono">{api?.spec?.versionPriority ?? '–'}</span>} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      <SectionCard icon={CheckCircle} title="Conditions" tooltip="Status conditions" className="lg:col-span-2">
        {conditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conditions.</p>
        ) : (
          <div className="space-y-3">
            {conditions.map((c) => (
              <div key={c.type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <Badge variant={c.status === 'True' ? 'default' : 'secondary'}>{c.type}</Badge>
                  <span className="text-sm text-muted-foreground">{c.reason ?? '–'}</span>
                </div>
                <p className="text-sm font-semibold">{c.message ?? '–'}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={api?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={api?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function APIServiceDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<APIServiceResource>
      resourceType="apiservices"
      kind="APIService"
      pluralLabel="API Services"
      listPath="/apiservices"
      resourceIcon={FileCode}
      customTabs={customTabs}
      deriveStatus={(api) => {
        const condition = api?.status?.conditions?.find((c) => c.type === 'Available');
        return condition?.status === 'True' ? 'Healthy' : 'Failed';
      }}
      buildStatusCards={(ctx) => {
        const api = ctx.resource;
        const condition = api?.status?.conditions?.find((c) => c.type === 'Available');
        const available = condition?.status === 'True';
        const serviceRef = api?.spec?.service
          ? `${api.spec.service.namespace}/${api.spec.service.name}`
          : 'Local';
        const group = api?.spec?.group ?? '–';
        const version = api?.spec?.version ?? '–';

        return [
          { label: 'Available', value: available ? 'Yes' : 'No', icon: CheckCircle, iconColor: (available ? 'success' : 'error') as 'success' | 'error' },
          { label: 'Group / Version', value: `${group} / ${version}`, icon: FileCode, iconColor: 'primary' as const },
          { label: 'Service', value: serviceRef, icon: Server, iconColor: 'info' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
