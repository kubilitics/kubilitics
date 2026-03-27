import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Route, Clock, Star, Server, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
  type ActionItemConfig,
} from '@/components/resources';
import { useK8sResourceList, type KubernetesResource } from '@/hooks/useKubernetes';
import { toast } from '@/components/ui/sonner';

interface IngressClassResource extends KubernetesResource {
  spec?: {
    controller: string;
    parameters?: { apiGroup?: string; kind?: string; name?: string };
  };
}

function OverviewTab({ resource: icResource, age }: ResourceContext<IngressClassResource>) {
  const controller = icResource.spec?.controller ?? '—';
  const isDefault = icResource.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true';
  const params = icResource.spec?.parameters;
  const labels = icResource.metadata?.labels ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard title="Ingress Class Info" icon={Route}>
        <DetailRow label="Controller" value={<span className="font-mono">{controller}</span>} />
        <DetailRow label="Default Class" value={<Badge variant={isDefault ? 'default' : 'secondary'}>{isDefault ? 'Yes' : 'No'}</Badge>} />
        <DetailRow label="Age" value={age} />
      </SectionCard>
      {params && (
        <SectionCard title="Parameters" icon={Server}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <DetailRow label="API Group" value={params.apiGroup ?? '—'} />
            <DetailRow label="Kind" value={params.kind ?? '—'} />
            <DetailRow label="Name" value={params.name ?? '—'} />
          </div>
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={labels} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={icResource?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

function IngressesTab({ resource: icResource }: ResourceContext<IngressClassResource>) {
  const name = icResource.metadata?.name;
  const ingressesList = useK8sResourceList<KubernetesResource & { spec?: { ingressClassName?: string } }>('ingresses', undefined, { enabled: !!name });
  const ingressesUsingThisClass = useMemo(() => {
    if (!name || !ingressesList.data?.items?.length) return [];
    return (ingressesList.data.items as Array<{ metadata?: { name?: string; namespace?: string }; spec?: { ingressClassName?: string } }>).filter(
      (ing) => ing.spec?.ingressClassName === name
    );
  }, [name, ingressesList.data?.items]);

  return (
    <SectionCard title="Ingresses using this class" icon={Route}>
      {ingressesUsingThisClass.length === 0 ? (
        <p className="text-muted-foreground text-sm">No ingresses use this class.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/40"><th className="text-left p-2">Name</th><th className="text-left p-2">Namespace</th><th className="text-left p-2">Actions</th></tr></thead>
            <tbody>
              {ingressesUsingThisClass.map((ing) => (
                <tr key={`${ing.metadata?.namespace}-${ing.metadata?.name}`} className="border-b">
                  <td className="p-2 font-mono">{ing.metadata?.name}</td>
                  <td className="p-2">{ing.metadata?.namespace}</td>
                  <td className="p-2"><Link to={`/ingresses/${ing.metadata?.namespace}/${ing.metadata?.name}`} className="text-primary text-sm hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function ControllerTab({ resource: icResource }: ResourceContext<IngressClassResource>) {
  const controller = icResource.spec?.controller ?? '—';
  return (
    <SectionCard title="Controller details" icon={Server}>
      <p className="text-muted-foreground text-sm">Controller: <span className="font-mono">{controller}</span></p>
    </SectionCard>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  { id: 'ingresses', label: 'Ingresses Using This Class', icon: Route, render: (ctx) => <IngressesTab {...ctx} /> },
  { id: 'controller', label: 'Controller Details', icon: Server, render: (ctx) => <ControllerTab {...ctx} /> },
];

export default function IngressClassDetail() {
  return (
    <GenericResourceDetail<IngressClassResource>
      resourceType="ingressclasses"
      kind="IngressClass"
      pluralLabel="Ingress Classes"
      listPath="/ingressclasses"
      resourceIcon={Route}
      customTabs={customTabs}
      headerMetadata={(ctx) => {
        const isDefault = ctx.resource.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true';
        return (
          <span className="flex items-center gap-1.5 ml-2 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />Created {ctx.age}
            {ctx.isConnected && <Badge variant="outline" className="ml-2 text-xs">Live</Badge>}
            {isDefault && <><span className="mx-2">•</span><Star className="h-3.5 w-3.5 inline" />Default</>}
          </span>
        );
      }}
      extraActionItems={(ctx) => {
        const items: ActionItemConfig[] = [
          { icon: Star, label: 'Set as Default', description: 'Make this the default ingress class', onClick: () => toast.info('Set as default: patch annotation ingressclass.kubernetes.io/is-default-class') },
        ];
        return items;
      }}
      buildStatusCards={(ctx) => {
        const icResource = ctx.resource;
        const controller = icResource.spec?.controller ?? '—';
        const isDefault = icResource.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true';
        const params = icResource.spec?.parameters;
        return [
          { label: 'Controller', value: controller, icon: Server, iconColor: 'primary' as const },
          { label: 'Default', value: isDefault ? 'Yes' : 'No', icon: Star, iconColor: isDefault ? 'success' as const : 'muted' as const },
          { label: 'Ingresses Using', value: '—', icon: Route, iconColor: 'info' as const },
          { label: 'Parameters', value: params ? `${params.kind ?? ''} ${params.name ?? ''}`.trim() || '—' : '—', icon: Server, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
