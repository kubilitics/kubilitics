// AWS service icons
import awsAlb from './cloud/aws/alb.svg';
import awsNlb from './cloud/aws/nlb.svg';
import awsEc2 from './cloud/aws/ec2.svg';
import awsEbs from './cloud/aws/ebs.svg';
import awsEfs from './cloud/aws/efs.svg';
import awsS3 from './cloud/aws/s3.svg';
import awsEcr from './cloud/aws/ecr.svg';
import awsRoute53 from './cloud/aws/route53.svg';
import awsIam from './cloud/aws/iam.svg';
import awsSecretsManager from './cloud/aws/secrets-manager.svg';
import awsCloudwatch from './cloud/aws/cloudwatch.svg';
import awsEks from './cloud/aws/eks.svg';
import awsSecurityGroups from './cloud/aws/security-groups.svg';

// Azure service icons
import azureLb from './cloud/azure/load-balancer.svg';
import azureAppGw from './cloud/azure/application-gateway.svg';
import azureVm from './cloud/azure/virtual-machines.svg';
import azureDisks from './cloud/azure/managed-disks.svg';
import azureBlob from './cloud/azure/blob-storage.svg';
import azureCr from './cloud/azure/container-registry.svg';
import azureDns from './cloud/azure/dns.svg';
import azureKeyVault from './cloud/azure/key-vault.svg';
import azureEntraId from './cloud/azure/entra-id.svg';
import azureMonitor from './cloud/azure/monitor.svg';
import azureAks from './cloud/azure/aks.svg';
import azureNsg from './cloud/azure/nsg.svg';

// GCP service icons
import gcpLb from './cloud/gcp/cloud-load-balancing.svg';
import gcpGce from './cloud/gcp/gce.svg';
import gcpPd from './cloud/gcp/persistent-disk.svg';
import gcpGcs from './cloud/gcp/cloud-storage.svg';
import gcpAr from './cloud/gcp/artifact-registry.svg';
import gcpDns from './cloud/gcp/cloud-dns.svg';
import gcpIam from './cloud/gcp/iam.svg';
import gcpSecretManager from './cloud/gcp/secret-manager.svg';
import gcpMonitoring from './cloud/gcp/cloud-monitoring.svg';
import gcpGke from './cloud/gcp/gke.svg';
import gcpArmor from './cloud/gcp/cloud-armor.svg';

export interface CloudIconMetadata {
  serviceType?: string;
  storageClass?: string;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

interface CloudIconRule {
  kind: string;
  match?: (meta?: CloudIconMetadata) => boolean;
  icon: string;
}

const awsRules: CloudIconRule[] = [
  { kind: 'service', match: (m) => m?.serviceType === 'LoadBalancer', icon: awsAlb },
  { kind: 'service', match: (m) => m?.serviceType === 'NodePort', icon: awsNlb },
  { kind: 'ingress', icon: awsAlb },
  { kind: 'node', icon: awsEc2 },
  { kind: 'persistentvolume', match: (m) => !m?.storageClass || m.storageClass.includes('ebs') || m.storageClass.includes('gp'), icon: awsEbs },
  { kind: 'persistentvolume', match: (m) => m?.storageClass?.includes('efs') === true, icon: awsEfs },
  { kind: 'persistentvolumeclaim', match: (m) => !m?.storageClass || m.storageClass.includes('ebs') || m.storageClass.includes('gp'), icon: awsEbs },
  { kind: 'persistentvolumeclaim', match: (m) => m?.storageClass?.includes('efs') === true, icon: awsEfs },
  { kind: 'secret', icon: awsSecretsManager },
  { kind: 'serviceaccount', icon: awsIam },
  { kind: 'networkpolicy', icon: awsSecurityGroups },
  { kind: 'namespace', icon: awsEks },
];

const azureRules: CloudIconRule[] = [
  { kind: 'service', match: (m) => m?.serviceType === 'LoadBalancer', icon: azureLb },
  { kind: 'ingress', icon: azureAppGw },
  { kind: 'node', icon: azureVm },
  { kind: 'persistentvolume', icon: azureDisks },
  { kind: 'persistentvolumeclaim', icon: azureDisks },
  { kind: 'secret', icon: azureKeyVault },
  { kind: 'serviceaccount', icon: azureEntraId },
  { kind: 'networkpolicy', icon: azureNsg },
  { kind: 'namespace', icon: azureAks },
];

const gcpRules: CloudIconRule[] = [
  { kind: 'service', match: (m) => m?.serviceType === 'LoadBalancer', icon: gcpLb },
  { kind: 'ingress', icon: gcpLb },
  { kind: 'node', icon: gcpGce },
  { kind: 'persistentvolume', icon: gcpPd },
  { kind: 'persistentvolumeclaim', icon: gcpPd },
  { kind: 'secret', icon: gcpSecretManager },
  { kind: 'serviceaccount', icon: gcpIam },
  { kind: 'networkpolicy', icon: gcpArmor },
  { kind: 'namespace', icon: gcpGke },
];

const providerRules: Record<string, CloudIconRule[]> = {
  eks: awsRules,
  aks: azureRules,
  gke: gcpRules,
};

export function getCloudIcon(
  provider: string,
  kind: string,
  metadata?: CloudIconMetadata
): string | null {
  const rules = providerRules[provider];
  if (!rules) return null;

  const normalizedKind = kind.toLowerCase();
  for (const rule of rules) {
    if (rule.kind !== normalizedKind) continue;
    if (rule.match && !rule.match(metadata)) continue;
    return rule.icon;
  }
  return null;
}

// Re-export unused imports to satisfy the bundler (they may be used directly by consumers)
export {
  awsAlb, awsNlb, awsEc2, awsEbs, awsEfs, awsS3, awsEcr, awsRoute53,
  awsIam, awsSecretsManager, awsCloudwatch, awsEks, awsSecurityGroups,
  azureLb, azureAppGw, azureVm, azureDisks, azureBlob, azureCr,
  azureDns, azureKeyVault, azureEntraId, azureMonitor, azureAks, azureNsg,
  gcpLb, gcpGce, gcpPd, gcpGcs, gcpAr, gcpDns, gcpIam,
  gcpSecretManager, gcpMonitoring, gcpGke, gcpArmor,
};
