import { Shield, Clock, Lock, AlertTriangle, Info, UserCircle } from 'lucide-react';
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

interface PodSecurityPolicyResource extends KubernetesResource {
  spec?: {
    privileged?: boolean;
    allowPrivilegeEscalation?: boolean;
    requiredDropCapabilities?: string[];
    volumes?: string[];
    hostNetwork?: boolean;
    hostPID?: boolean;
    hostIPC?: boolean;
    runAsUser?: { rule?: string };
    seLinux?: { rule?: string };
    fsGroup?: { rule?: string };
    supplementalGroups?: { rule?: string };
  };
}

function OverviewTab({ resource: psp }: ResourceContext<PodSecurityPolicyResource>) {
  const spec = psp?.spec ?? {};
  const privileged = spec.privileged ?? false;
  const allowPrivilegeEscalation = spec.allowPrivilegeEscalation ?? false;
  const hostNetwork = spec.hostNetwork ?? false;
  const hostPID = spec.hostPID ?? false;
  const volumes = spec.volumes ?? [];
  const requiredDropCapabilities = spec.requiredDropCapabilities ?? [];
  const runAsUserRule = spec.runAsUser?.rule ?? 'RunAsAny';
  const seLinuxRule = spec.seLinux?.rule ?? 'RunAsAny';
  const fsGroupRule = spec.fsGroup?.rule ?? 'RunAsAny';
  const supplementalGroupsRule = spec.supplementalGroups?.rule ?? 'RunAsAny';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <SectionCard icon={Lock} title="Security Settings">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow
            label="Privileged"
            value={
              <Badge variant={privileged ? 'destructive' : 'default'}>
                {privileged ? 'Allowed' : 'Denied'}
              </Badge>
            }
          />
          <DetailRow
            label="Privilege Escalation"
            value={
              <Badge variant={allowPrivilegeEscalation ? 'destructive' : 'default'}>
                {allowPrivilegeEscalation ? 'Allowed' : 'Denied'}
              </Badge>
            }
          />
          <DetailRow
            label="Host Network"
            value={
              <Badge variant={hostNetwork ? 'destructive' : 'secondary'}>
                {hostNetwork ? 'Allowed' : 'Denied'}
              </Badge>
            }
          />
          <DetailRow
            label="Host PID"
            value={
              <Badge variant={hostPID ? 'destructive' : 'secondary'}>
                {hostPID ? 'Allowed' : 'Denied'}
              </Badge>
            }
          />
        </div>
      </SectionCard>
      <SectionCard icon={UserCircle} title="Run As User">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <DetailRow label="Run As User Rule" value={<Badge variant="outline">{runAsUserRule}</Badge>} />
          <DetailRow label="SELinux Rule" value={<Badge variant="outline">{seLinuxRule}</Badge>} />
          <DetailRow label="FS Group Rule" value={<Badge variant="outline">{fsGroupRule}</Badge>} />
          <DetailRow label="Supplemental Groups" value={<Badge variant="outline">{supplementalGroupsRule}</Badge>} />
        </div>
      </SectionCard>
      <SectionCard icon={Info} title="Allowed Volumes">
        <div className="flex flex-wrap gap-2">
          {volumes.map((vol) => (
            <Badge key={vol} variant="secondary">{vol}</Badge>
          ))}
          {volumes.length === 0 && <p className="text-sm text-muted-foreground">No volumes specified</p>}
        </div>
      </SectionCard>
      <SectionCard icon={AlertTriangle} title="Required Drop Capabilities">
        <div className="flex flex-wrap gap-2">
          {requiredDropCapabilities.map((cap) => (
            <Badge key={cap} variant="destructive">{cap}</Badge>
          ))}
          {requiredDropCapabilities.length === 0 && <p className="text-sm text-muted-foreground">None</p>}
        </div>
      </SectionCard>
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={psp?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={psp?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

export default function PodSecurityPolicyDetail() {
  const customTabs: CustomTab[] = [
    { id: 'overview', label: 'Overview', render: (ctx) => <OverviewTab {...ctx} /> },
  ];

  return (
    <GenericResourceDetail<PodSecurityPolicyResource>
      resourceType="podsecuritypolicies"
      kind="PodSecurityPolicy"
      pluralLabel="Pod Security Policies"
      listPath="/podsecuritypolicies"
      resourceIcon={Shield}
      customTabs={customTabs}
      deriveStatus={() => 'Healthy'}
      buildStatusCards={(ctx) => {
        const psp = ctx.resource;
        const spec = psp?.spec ?? {};
        const privileged = spec.privileged ?? false;
        const hostNetwork = spec.hostNetwork ?? false;
        const volumes = spec.volumes ?? [];

        return [
          { label: 'Privileged', value: privileged ? 'Yes' : 'No', icon: Lock, iconColor: privileged ? 'error' as const : 'success' as const },
          { label: 'Host Network', value: hostNetwork ? 'Yes' : 'No', icon: Shield, iconColor: 'info' as const },
          { label: 'Volumes', value: volumes.length, icon: AlertTriangle, iconColor: 'warning' as const },
          { label: 'Age', value: ctx.age, icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
