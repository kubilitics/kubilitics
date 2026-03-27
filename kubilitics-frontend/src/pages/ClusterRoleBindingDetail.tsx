import { useNavigate } from 'react-router-dom';
import { Link2, ShieldCheck, UserCircle, Globe, Users } from 'lucide-react';
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

interface Subject {
  kind: string;
  name: string;
  namespace?: string;
  apiGroup?: string;
}

interface ClusterRoleBindingResource extends KubernetesResource {
  roleRef?: { kind?: string; name?: string; apiGroup?: string };
  subjects?: Subject[];
}

function OverviewTab({ resource }: ResourceContext<ClusterRoleBindingResource>) {
  const navigate = useNavigate();
  const roleRef = resource?.roleRef ?? {};
  const subjects = resource?.subjects ?? [];
  const clusterRoleName = roleRef.name ?? '–';
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={ShieldCheck} title="Cluster Role Reference">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Kind" value={<Badge variant="secondary">ClusterRole</Badge>} />
          <DetailRow
            label="Name"
            value={
              <span
                className={clusterRoleName !== '–' ? 'cursor-pointer text-primary hover:underline font-semibold' : 'font-semibold'}
                onClick={() => clusterRoleName !== '–' && navigate(`/clusterroles/${clusterRoleName}`)}
              >
                {clusterRoleName}
              </span>
            }
          />
          <DetailRow label="API Group" value={<span className="font-mono">{roleRef.apiGroup ?? 'rbac.authorization.k8s.io'}</span>} />
        </div>
      </SectionCard>
      <SectionCard icon={Users} title="Subjects">
        <div className="space-y-3">
          {subjects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No subjects</p>
          ) : (
            subjects.map((subject, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/50">
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <DetailRow label="Kind" value={<Badge variant="outline">{subject.kind}</Badge>} />
                  <DetailRow label="Name" value={<span className="font-semibold">{subject.name}</span>} />
                  {subject.namespace && <DetailRow label="Namespace" value={subject.namespace} />}
                </div>
              </div>
            ))
          )}
        </div>
      </SectionCard>
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

function SubjectsTab({ resource }: ResourceContext<ClusterRoleBindingResource>) {
  const navigate = useNavigate();
  const subjects = resource?.subjects ?? [];

  return (
    <SectionCard icon={Users} title="Subject Details">
      <div className="space-y-3">
        {subjects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No subjects</p>
        ) : (
          subjects.map((subject, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{subject.kind}</Badge>
                <span className="font-mono text-sm font-semibold">{subject.name}</span>
                {subject.namespace && <span className="text-xs text-muted-foreground">({subject.namespace})</span>}
              </div>
              {subject.kind === 'ServiceAccount' && subject.namespace && (
                <Button variant="link" size="sm" onClick={() => navigate(`/serviceaccounts/${subject.namespace}/${subject.name}`)}>
                  View Service Account
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}

function ClusterRoleDetailsTab({ resource }: ResourceContext<ClusterRoleBindingResource>) {
  const navigate = useNavigate();
  const clusterRoleName = resource?.roleRef?.name ?? '–';

  return (
    <SectionCard icon={ShieldCheck} title="Referenced ClusterRole">
        <p className="text-muted-foreground text-sm mb-2">This binding references the following ClusterRole.</p>
        <Button variant="outline" onClick={() => clusterRoleName !== '–' && navigate(`/clusterroles/${clusterRoleName}`)}>
          View ClusterRole: {clusterRoleName}
        </Button>
    </SectionCard>
  );
}

export default function ClusterRoleBindingDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'subjects', label: 'Subjects', render: (ctx) => <SubjectsTab {...ctx} /> },
    { id: 'clusterrole-details', label: 'ClusterRole Details', render: (ctx) => <ClusterRoleDetailsTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<ClusterRoleBindingResource>
      resourceType="clusterrolebindings"
      kind="ClusterRoleBinding"
      pluralLabel="Cluster Role Bindings"
      listPath="/clusterrolebindings"
      resourceIcon={Link2}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const roleRef = ctx.resource?.roleRef ?? {};
        const subjects = ctx.resource?.subjects ?? [];
        const clusterRoleName = roleRef.name ?? '–';
        const subjectKinds = [...new Set(subjects.map((s) => s.kind))];

        return [
          { label: 'ClusterRole', value: clusterRoleName, icon: ShieldCheck, iconColor: 'primary' as const },
          { label: 'Subject Count', value: subjects.length, icon: UserCircle, iconColor: 'info' as const },
          { label: 'Subject Types', value: subjectKinds.join(', ') || '–', icon: UserCircle, iconColor: 'muted' as const },
          { label: 'Scope', value: 'Cluster-wide', icon: Globe, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
