import { History, Clock, Info, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
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

interface K8sControllerRevision extends KubernetesResource {
  revision?: number;
  data?: unknown;
  metadata: KubernetesResource['metadata'] & {
    ownerReferences?: Array<{ kind: string; name: string }>;
  };
}

function OverviewTab({ resource: cr, age }: ResourceContext<K8sControllerRevision>) {
  const crNamespace = cr?.metadata?.namespace ?? '';
  const revision = (cr as K8sControllerRevision).revision ?? 0;
  const ownerRef = cr?.metadata?.ownerReferences?.find((r) => r.kind === 'StatefulSet' || r.kind === 'DaemonSet');
  const ownerKind = ownerRef?.kind ?? '—';
  const ownerName = ownerRef?.name ?? '—';
  const ownerLink = ownerKind === 'StatefulSet' && ownerName !== '—'
    ? `/statefulsets/${crNamespace}/${ownerName}`
    : ownerKind === 'DaemonSet' && ownerName !== '—'
      ? `/daemonsets/${crNamespace}/${ownerName}`
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={History} title="Revision Info" tooltip={<p className="text-xs text-muted-foreground">Controller revision metadata</p>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Revision" value={<Badge variant="outline" className="font-mono">{revision}</Badge>} />
          <DetailRow label="Owner" value={ownerLink ? <Link to={ownerLink} className="text-primary hover:underline font-mono">{ownerKind}/{ownerName}</Link> : <span className="font-semibold">{ownerKind}/{ownerName}</span>} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      {ownerLink && (
        <SectionCard icon={Layers} title="Parent Resource" tooltip={<p className="text-xs text-muted-foreground">The StatefulSet or DaemonSet this revision belongs to</p>}>
          <p className="text-sm text-muted-foreground mb-2">
            This ControllerRevision stores the template for revision {revision} of the {ownerKind}.
          </p>
          <Link to={ownerLink} className="text-primary hover:underline font-mono text-sm font-semibold">
            {ownerKind}/{ownerName}
          </Link>
        </SectionCard>
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={cr?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={cr?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function ControllerRevisionDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<K8sControllerRevision>
      resourceType="controllerrevisions"
      kind="ControllerRevision"
      pluralLabel="Controller Revisions"
      listPath="/controllerrevisions"
      resourceIcon={History}
      customTabs={customTabs}
      loadingCardCount={3}
      buildStatusCards={(ctx) => {
        const cr = ctx.resource;
        const crNamespace = cr?.metadata?.namespace ?? '';
        const revision = (cr as K8sControllerRevision).revision ?? 0;
        const ownerRef = cr?.metadata?.ownerReferences?.find((r) => r.kind === 'StatefulSet' || r.kind === 'DaemonSet');
        const ownerKind = ownerRef?.kind ?? '—';
        const ownerName = ownerRef?.name ?? '—';

        return [
          { label: 'Namespace', value: crNamespace, icon: History, iconColor: 'primary' as const },
          { label: 'Owner', value: `${ownerKind}/${ownerName}`, icon: Layers, iconColor: 'info' as const },
          { label: 'Revision', value: String(revision), icon: History, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
