// src/lib/parseInsightPods.ts

export interface PodReference {
  namespace: string;
  name: string;
}

/**
 * Extract pod namespace/name pairs from an insight detail string.
 * Handles formats like:
 *   "3 pod(s) in CrashLoopBackOff: ns1/pod1, ns2/pod2, ns3/pod3"
 *   "ns/pod-name is failing"
 */
export function parseInsightPods(detail: string): PodReference[] {
  const pods: PodReference[] = [];
  // Match namespace/pod-name patterns (K8s names: lowercase alphanumeric, hyphens, dots)
  const regex = /([a-z0-9][-a-z0-9.]*)\/([a-z0-9][-a-z0-9.]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(detail)) !== null) {
    pods.push({ namespace: match[1], name: match[2] });
  }

  return pods;
}
