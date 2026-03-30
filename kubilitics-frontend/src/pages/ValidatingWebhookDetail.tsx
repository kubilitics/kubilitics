import { Webhook, Shield, AlertTriangle, Clock, Info } from 'lucide-react';
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

interface ValidatingWebhookResource extends KubernetesResource {
  webhooks?: Array<{
    name: string;
    failurePolicy?: string;
    matchPolicy?: string;
    sideEffects?: string;
    timeoutSeconds?: number;
    admissionReviewVersions?: string[];
    rules?: Array<{
      apiGroups: string[];
      apiVersions: string[];
      operations: string[];
      resources: string[];
    }>;
    clientConfig?: {
      service?: { name: string; namespace: string; port: number };
      url?: string;
    };
    namespaceSelector?: {
      matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
      matchLabels?: Record<string, string>;
    };
  }>;
}

function OverviewTab({ resource: wh }: ResourceContext<ValidatingWebhookResource>) {
  const webhooks = wh?.webhooks ?? [];

  return (
    <div className="space-y-6">
      {webhooks.length === 0 ? (
        <SectionCard icon={Webhook} title="Webhooks"><p className="text-sm text-muted-foreground">No webhooks configured</p></SectionCard>
      ) : (
        webhooks.map((webhook, idx) => (
          <SectionCard key={idx} icon={Webhook} title={webhook.name}>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <DetailRow label="Failure Policy" value={<Badge variant={webhook.failurePolicy === 'Fail' ? 'destructive' : 'secondary'}>{webhook.failurePolicy}</Badge>} />
                <DetailRow label="Match Policy" value={<Badge variant="outline">{webhook.matchPolicy}</Badge>} />
                <DetailRow label="Side Effects" value={<Badge variant="outline">{webhook.sideEffects}</Badge>} />
                <DetailRow label="Timeout" value={`${webhook.timeoutSeconds}s`} />
                <DetailRow
                  label="Client Config"
                  value={
                    webhook.clientConfig?.service
                      ? `${webhook.clientConfig.service.namespace}/${webhook.clientConfig.service.name}:${webhook.clientConfig.service.port}`
                      : webhook.clientConfig?.url
                        ? webhook.clientConfig.url
                        : 'No client configuration'
                  }
                />
              </div>
              {webhook.rules && webhook.rules.length > 0 && (
                <div className="mt-4">
                  <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">Rules</span>
                  <div className="mt-2 space-y-2">
                    {webhook.rules.map((rule, ruleIdx) => (
                      <div key={ruleIdx} className="p-3 rounded-lg bg-muted/50 text-sm font-mono">
                        <p>Groups: {rule.apiGroups.join(', ')}</p>
                        <p>Versions: {rule.apiVersions.join(', ')}</p>
                        <p>Operations: {rule.operations.join(', ')}</p>
                        <p>Resources: {rule.resources.join(', ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {webhook.namespaceSelector && (
                <div className="mt-4">
                  <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wider">Namespace Selector</span>
                  <div className="mt-2 p-3 rounded-lg bg-muted/50 text-sm font-mono">
                    {webhook.namespaceSelector.matchExpressions?.map((expr, i) => (
                      <p key={i}>{expr.key} {expr.operator} {expr.values?.join(', ')}</p>
                    ))}
                    {webhook.namespaceSelector.matchLabels && (
                      <p>Labels: {JSON.stringify(webhook.namespaceSelector.matchLabels)}</p>
                    )}
                  </div>
                </div>
              )}
          </SectionCard>
        ))
      )}
      <div className="lg:col-span-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LabelList labels={wh?.metadata?.labels ?? {}} />
        </div>
      </div>
      <div className="lg:col-span-2">
        <AnnotationList annotations={wh?.metadata?.annotations ?? {}} />
      </div>
    </div>
  );
}

const customTabs: CustomTab[] = [
  { id: 'overview', label: 'Overview', icon: Info, render: (ctx) => <OverviewTab {...ctx} /> },
];

export default function ValidatingWebhookDetail() {
  return (
    <GenericResourceDetail<ValidatingWebhookResource>
      resourceType="validatingwebhookconfigurations"
      kind="ValidatingWebhookConfiguration"
      pluralLabel="Validating Webhooks"
      listPath="/validatingwebhooks"
      resourceIcon={Webhook}
      customTabs={customTabs}
      buildStatusCards={(ctx) => {
        const webhooks = ctx.resource?.webhooks ?? [];
        return [
          { label: 'Webhooks', value: webhooks.length, icon: Webhook, iconColor: 'primary' as const },
          { label: 'Failure Policy', value: webhooks[0]?.failurePolicy || '-', icon: AlertTriangle, iconColor: 'warning' as const },
          { label: 'Side Effects', value: webhooks[0]?.sideEffects || '-', icon: Shield, iconColor: 'info' as const },
          { label: 'Age', value: ctx.age || '-', icon: Clock, iconColor: 'muted' as const },
        ];
      }}
    />
  );
}
