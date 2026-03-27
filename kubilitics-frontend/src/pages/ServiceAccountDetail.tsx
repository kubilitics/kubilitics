import { useNavigate } from 'react-router-dom';
import { UserCircle, KeyRound, Shield, Info, Key, Image, Server } from 'lucide-react';
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

interface ServiceAccountResource extends KubernetesResource {
  secrets?: Array<{ name?: string }>;
  imagePullSecrets?: Array<{ name?: string }>;
  automountServiceAccountToken?: boolean;
}

function OverviewTab({ resource, namespace, age }: ResourceContext<ServiceAccountResource>) {
  const navigate = useNavigate();
  const secrets = resource?.secrets ?? [];
  const imagePullSecrets = resource?.imagePullSecrets ?? [];
  const automount = resource?.automountServiceAccountToken !== false;
  const labels = resource?.metadata?.labels ?? {};
  const annotations = resource?.metadata?.annotations ?? {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Info} title="Service Account Info">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Automount Token" value={<Badge variant={automount ? 'default' : 'secondary'}>{automount ? 'Yes' : 'No'}</Badge>} />
          <DetailRow label="Age" value={age} />
        </div>
      </SectionCard>
      <SectionCard icon={Key} title="Secrets">
          <div className="space-y-2">
            {secrets.length === 0 ? (
              <p className="text-muted-foreground text-sm">No secrets</p>
            ) : (
              secrets.map((s) => (
                <div
                  key={s.name}
                  className="p-2 rounded-lg bg-muted/50 font-mono text-sm cursor-pointer hover:bg-muted"
                  onClick={() => navigate(`/secrets/${namespace}/${s.name}`)}
                >
                  {s.name}
                </div>
              ))
            )}
          </div>
      </SectionCard>
      <SectionCard icon={Image} title="Image Pull Secrets">
          <div className="flex flex-wrap gap-2">
            {imagePullSecrets.length === 0 ? (
              <p className="text-muted-foreground text-sm">None</p>
            ) : (
              imagePullSecrets.map((s) => (
                <Badge key={s.name} variant="outline" className="font-mono cursor-pointer" onClick={() => navigate(`/secrets/${namespace}/${s.name}`)}>
                  {s.name}
                </Badge>
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

function PermissionsTab() {
  return (
    <SectionCard icon={Shield} title="RoleBindings / ClusterRoleBindings">
        <p className="text-muted-foreground text-sm">Bindings that reference this ServiceAccount would be listed here. Use the cluster RBAC APIs or list RoleBindings/ClusterRoleBindings and filter by subject to see them.</p>
    </SectionCard>
  );
}

function UsedByTab({ namespace }: ResourceContext<ServiceAccountResource>) {
  const navigate = useNavigate();
  return (
    <SectionCard icon={Server} title="Pods / Workloads">
        <p className="text-muted-foreground text-sm">Pods and workloads using this ServiceAccount (e.g. <code>spec.serviceAccountName</code>) can be listed when backend supports it or by listing pods in this namespace.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate(`/pods?namespace=${namespace}`)}>View Pods in {namespace}</Button>
    </SectionCard>
  );
}

export default function ServiceAccountDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
    { id: 'permissions', label: 'Permissions', render: () => <PermissionsTab /> },
    { id: 'usedby', label: 'Used By', render: (ctx) => <UsedByTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<ServiceAccountResource>
      resourceType="serviceaccounts"
      kind="ServiceAccount"
      pluralLabel="Service Accounts"
      listPath="/serviceaccounts"
      resourceIcon={UserCircle}
      loadingCardCount={5}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const secrets = ctx.resource?.secrets ?? [];
        const automount = ctx.resource?.automountServiceAccountToken !== false;

        return [
          { label: 'Secrets', value: secrets.length, icon: KeyRound, iconColor: 'primary' as const },
          { label: 'Pods Using', value: '–', icon: UserCircle, iconColor: 'muted' as const },
          { label: 'Roles Bound', value: '–', icon: Shield, iconColor: 'muted' as const },
          { label: 'Permission Level', value: '–', icon: Shield, iconColor: 'muted' as const },
          { label: 'Token Auto-Mount', value: automount ? 'Yes' : 'No', icon: KeyRound, iconColor: 'info' as const },
        ];
      }}
    />
  );
}
