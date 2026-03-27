import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FolderCog, Clock, Cpu, Settings, Package, Box, Info, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NamespaceBadge } from '@/components/list';
import {
  GenericResourceDetail,
  SectionCard,
  DetailRow,
  LabelList,
  AnnotationList,
  type CustomTab,
  type ResourceContext,
} from '@/components/resources';
import { useK8sResourceList, calculateAge, type KubernetesResource } from '@/hooks/useKubernetes';

interface K8sRuntimeClass extends KubernetesResource {
  handler?: string;
  overhead?: { podFixed?: { cpu?: string; memory?: string } };
  scheduling?: {
    nodeSelector?: Record<string, string>;
    tolerations?: Array<{ key?: string; operator?: string; value?: string; effect?: string }>;
  };
}

interface PodWithRuntime extends KubernetesResource {
  spec?: { runtimeClassName?: string };
}

function OverviewTab({ resource: k8sRc, age, isConnected }: ResourceContext<K8sRuntimeClass>) {
  const navigate = useNavigate();
  const name = k8sRc?.metadata?.name;
  const handler = k8sRc?.handler ?? '—';
  const overhead = k8sRc?.overhead;
  const scheduling = k8sRc?.scheduling;

  const { data: podsData } = useK8sResourceList<PodWithRuntime>('pods', undefined, { enabled: !!name && isConnected, limit: 5000 });
  const podsUsingRuntime = useMemo(() => {
    if (!name || !podsData?.items) return [];
    return podsData.items.filter((p) => p.spec?.runtimeClassName === name);
  }, [name, podsData?.items]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard icon={Info} title="Runtime Info">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <DetailRow label="Handler" value={<Badge variant="default" className="font-mono">{handler}</Badge>} />
              <DetailRow label="Age" value={age} />
            </div>
            <div className="pt-2">
              <p className="text-sm text-muted-foreground">
                The handler specifies the underlying runtime configuration. Pods using this RuntimeClass
                run with the configured isolation and overhead.
              </p>
            </div>
        </SectionCard>
        <SectionCard icon={Cpu} title="Overhead" tooltip="Additional resources consumed by the runtime">
            {overhead?.podFixed ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <DetailRow label="CPU" value={<span className="font-mono">{overhead.podFixed.cpu}</span>} />
                <DetailRow label="Memory" value={<span className="font-mono">{overhead.podFixed.memory}</span>} />
              </div>
            ) : (
              <p className="text-muted-foreground">No overhead defined</p>
            )}
        </SectionCard>
        {scheduling && (
          <>
            <SectionCard icon={Target} title="Node Selector">
                {scheduling.nodeSelector && Object.keys(scheduling.nodeSelector).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(scheduling.nodeSelector).map(([key, value]) => (
                      <Badge key={key} variant="outline" className="font-mono text-xs">{key}={value}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No node selector defined</p>
                )}
            </SectionCard>
            <SectionCard icon={Settings} title="Tolerations">
                {scheduling.tolerations && scheduling.tolerations.length > 0 ? (
                  <div className="space-y-2">
                    {scheduling.tolerations.map((tol, idx) => (
                      <div key={idx} className="p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2 flex-wrap">
                          {tol.key != null && <Badge variant="outline" className="font-mono text-xs">{tol.key}</Badge>}
                          {tol.operator != null && <span className="text-muted-foreground">{tol.operator}</span>}
                          {tol.value != null && <Badge variant="secondary" className="font-mono text-xs">{tol.value}</Badge>}
                          {tol.effect != null && <Badge variant="destructive" className="text-xs">{tol.effect}</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No tolerations defined</p>
                )}
            </SectionCard>
          </>
        )}
        <SectionCard icon={Package} title="Pods Using This RuntimeClass" tooltip={`${podsUsingRuntime.length} pods are using this runtime class`} className="lg:col-span-2">
            {podsUsingRuntime.length === 0 ? (
              <p className="text-muted-foreground">No pods are using this RuntimeClass.</p>
            ) : (
              <div className="space-y-2">
                {podsUsingRuntime.map((pod) => (
                  <div
                    key={`${pod.metadata?.namespace ?? ''}/${pod.metadata?.name ?? ''}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => navigate(`/pods/${pod.metadata?.namespace ?? 'default'}/${pod.metadata?.name ?? ''}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Box className="h-4 w-4 text-primary" />
                      <span className="font-medium">{pod.metadata?.name ?? '—'}</span>
                    </div>
                    <NamespaceBadge namespace={pod.metadata?.namespace ?? ''} />
                  </div>
                ))}
              </div>
            )}
        </SectionCard>
      </div>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={k8sRc?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={k8sRc?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
];

export default function RuntimeClassDetail() {
  const { name } = useParams();

  if (!name?.trim()) return null;

  return (
    <GenericResourceDetail<K8sRuntimeClass>
      resourceType="runtimeclasses"
      kind="RuntimeClass"
      pluralLabel="Runtime Classes"
      listPath="/runtimeclasses"
      resourceIcon={FolderCog}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const k8sRc = ctx.resource;
        const handler = k8sRc?.handler ?? '—';
        const rcAge = k8sRc?.metadata?.creationTimestamp ? calculateAge(k8sRc.metadata.creationTimestamp) : '—';
        return [
          { label: 'Handler', value: handler, icon: Cpu, iconColor: 'primary' as const },
          { label: 'CPU Overhead', value: k8sRc?.overhead?.podFixed?.cpu ?? '—', icon: Settings, iconColor: 'info' as const },
          { label: 'Memory Overhead', value: k8sRc?.overhead?.podFixed?.memory ?? '—', icon: FolderCog, iconColor: 'warning' as const },
          { label: 'Age', value: rcAge, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
