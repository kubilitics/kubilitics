import type { ReasonCode } from './types';

/**
 * Static table of known Kubernetes reason codes mapped to plain-English
 * diagnostic information. This is the single source of truth consumed by:
 *  - podDiagnosis / controllerDiagnosis / jobDiagnosis / cronJobDiagnosis
 *  - the DiagnoseReasonCard component
 *  - toDescribeText for clipboard output
 *
 * Adding a new reason = add a row. No other code changes required.
 */
export const REASONS: Record<string, ReasonCode> = {
  CrashLoopBackOff: {
    code: 'CrashLoopBackOff',
    severity: 'broken',
    title: 'Container keeps crashing',
    explanation:
      'Your container started, ran briefly, and crashed — then restarted and crashed again. Kubernetes is now waiting longer between retries (exponential backoff).',
    suggestions: [
      {
        text: 'Read the crash output from the previous run',
        kubectlHint: 'kubectl logs -n {namespace} {pod} --previous',
        action: { type: 'jump_to_tab', tab: 'logs' },
      },
      {
        text: 'Check the container command and args in the YAML',
        action: { type: 'jump_to_tab', tab: 'yaml' },
      },
      {
        text: 'Exit code 128 almost always means a missing binary or typo in the command',
      },
    ],
  },
  ImagePullBackOff: {
    code: 'ImagePullBackOff',
    severity: 'broken',
    title: "Container image can't be pulled",
    explanation:
      'Kubernetes could not download the container image from the registry. Usually the image name is wrong, the tag does not exist, or credentials to a private registry are missing.',
    suggestions: [
      {
        text: 'Verify the image name and tag in the YAML',
        action: { type: 'jump_to_tab', tab: 'yaml' },
      },
      {
        text: 'If using a private registry, ensure the imagePullSecret is referenced and valid',
      },
      {
        text: 'Check recent events for the exact pull error',
        action: { type: 'jump_to_tab', tab: 'events' },
      },
    ],
  },
  ErrImagePull: {
    code: 'ErrImagePull',
    severity: 'broken',
    title: 'Image pull failed',
    explanation:
      'A single attempt to pull the container image failed. Kubernetes will retry, but if the problem is the image reference (typo, missing tag) it will never succeed.',
    suggestions: [
      { text: 'Verify the image name and tag in the YAML', action: { type: 'jump_to_tab', tab: 'yaml' } },
      { text: 'Check events for the exact registry error', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  ErrImageNeverPull: {
    code: 'ErrImageNeverPull',
    severity: 'broken',
    title: 'Image is not present and pull is disabled',
    explanation:
      'imagePullPolicy is set to Never, but the image is not already on the node. Either pre-pull the image to the node or change the policy to IfNotPresent or Always.',
    suggestions: [
      { text: 'Change imagePullPolicy in the YAML', action: { type: 'jump_to_tab', tab: 'yaml' } },
    ],
  },
  InvalidImageName: {
    code: 'InvalidImageName',
    severity: 'broken',
    title: 'Image reference is malformed',
    explanation:
      'The image reference in your YAML is not a valid Docker-style reference. Check for typos, unescaped characters, or an accidental trailing colon.',
    suggestions: [
      { text: 'Fix the image field in the YAML', action: { type: 'jump_to_tab', tab: 'yaml' } },
    ],
  },
  CreateContainerConfigError: {
    code: 'CreateContainerConfigError',
    severity: 'broken',
    title: 'Container configuration is invalid',
    explanation:
      "The container couldn't start because of a configuration error — usually a missing ConfigMap, Secret, or volume mount that the container depends on.",
    suggestions: [
      { text: 'Check the event message for the exact missing resource', action: { type: 'jump_to_tab', tab: 'events' } },
      { text: 'Verify the referenced ConfigMap/Secret exists in the same namespace' },
    ],
  },
  CreateContainerError: {
    code: 'CreateContainerError',
    severity: 'broken',
    title: 'Runtime failed to create container',
    explanation:
      'The container runtime reported an error creating the container. Common causes: device / volume mount unavailable, container name conflict, or runtime bug.',
    suggestions: [
      { text: 'Check recent events for the underlying runtime error', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  RunContainerError: {
    code: 'RunContainerError',
    severity: 'broken',
    title: 'Runtime failed to start container',
    explanation:
      'The container runtime created the container but could not start its process. Usually a permission, capability, or resource limit issue on the host.',
    suggestions: [
      { text: 'Check recent events for the runtime error', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  ContainerCannotRun: {
    code: 'ContainerCannotRun',
    severity: 'broken',
    title: "Container couldn't start its process",
    explanation:
      'The container image loaded but the entrypoint process failed to execute — most often because the binary is missing or has the wrong architecture.',
    suggestions: [
      { text: 'Check the container command and args', action: { type: 'jump_to_tab', tab: 'yaml' } },
      { text: 'Verify the image was built for the right architecture (arm64 vs amd64)' },
    ],
  },
  KillContainerError: {
    code: 'KillContainerError',
    severity: 'degraded',
    title: 'Runtime failed to kill container',
    explanation:
      'Kubernetes asked the runtime to stop a container and the stop failed. The container may still be running. Usually transient.',
    suggestions: [
      { text: 'Wait and refresh — the runtime often recovers on retry' },
      { text: 'If persistent, check node health', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  StartError: {
    code: 'StartError',
    severity: 'broken',
    title: 'Container failed to start',
    explanation:
      'The OCI runtime (containerd / CRI-O) returned an error starting the container process. Read the terminated message for the exact cause.',
    suggestions: [
      { text: 'Read the last terminated message in the panel above' },
      { text: 'Check the container command and args', action: { type: 'jump_to_tab', tab: 'yaml' } },
    ],
  },
  OOMKilled: {
    code: 'OOMKilled',
    severity: 'broken',
    title: 'Container ran out of memory',
    explanation:
      "Kubernetes killed the container because it exceeded its memory limit. This is a hard kill — your process doesn't get a chance to clean up.",
    suggestions: [
      { text: 'Check metrics to see memory usage before the kill', action: { type: 'jump_to_tab', tab: 'metrics' } },
      { text: "Raise the container's memory limit in the YAML" },
      { text: 'If memory usage grows unboundedly, you may have a leak' },
    ],
  },
  Error: {
    code: 'Error',
    severity: 'broken',
    title: 'Container exited with error',
    explanation:
      'The container exited with a non-zero exit code. Read the terminated message and container logs for details.',
    suggestions: [
      { text: 'Read the previous container logs', action: { type: 'jump_to_tab', tab: 'logs' } },
    ],
  },
  Completed: {
    code: 'Completed',
    severity: 'healthy',
    title: 'Completed',
    explanation: 'The container finished successfully with exit code 0.',
    suggestions: [{ text: 'No action needed.' }],
  },
  DeadlineExceeded: {
    code: 'DeadlineExceeded',
    severity: 'broken',
    title: 'Job exceeded its deadline',
    explanation:
      'The Job ran longer than its activeDeadlineSeconds limit and was terminated. Either raise the deadline or optimize the job to finish faster.',
    suggestions: [
      { text: 'Raise activeDeadlineSeconds in the Job spec', action: { type: 'jump_to_tab', tab: 'yaml' } },
      { text: 'Check the last pod logs to see where the job got stuck', action: { type: 'jump_to_tab', tab: 'logs' } },
    ],
  },
  BackoffLimitExceeded: {
    code: 'BackoffLimitExceeded',
    severity: 'broken',
    title: 'Job failed too many times',
    explanation:
      'The Job has failed more times than backoffLimit allows. Kubernetes has given up retrying.',
    suggestions: [
      { text: 'Read the latest failed pod logs', action: { type: 'jump_to_tab', tab: 'logs' } },
      { text: 'Fix the underlying error and recreate the job' },
    ],
  },
  Evicted: {
    code: 'Evicted',
    severity: 'broken',
    title: 'Pod was evicted',
    explanation:
      'The node ran out of memory, disk, or another resource and evicted this pod to recover. Controllers (Deployment, StatefulSet) usually reschedule automatically.',
    suggestions: [
      { text: 'Check node conditions for resource pressure' },
      { text: 'Set resource requests to help the scheduler avoid overloaded nodes' },
    ],
  },
  NodeLost: {
    code: 'NodeLost',
    severity: 'broken',
    title: 'Node hosting this pod became unreachable',
    explanation:
      'The kubelet on the node stopped reporting to the control plane. The node may be rebooting, network-partitioned, or terminated.',
    suggestions: [
      { text: 'Check the node status in the Fleet page' },
    ],
  },
  NodeAffinity: {
    code: 'NodeAffinity',
    severity: 'broken',
    title: 'No node matches affinity rules',
    explanation:
      'Kubernetes could not find a node that satisfies the pod nodeAffinity / nodeSelector constraints.',
    suggestions: [
      { text: 'Review the pod nodeAffinity rules in the YAML', action: { type: 'jump_to_tab', tab: 'yaml' } },
      { text: 'Check that nodes have the labels the pod requires' },
    ],
  },
  NodeNotReady: {
    code: 'NodeNotReady',
    severity: 'degraded',
    title: 'Host node is not ready',
    explanation:
      'The node hosting this pod is temporarily not Ready. Usually transient — wait for the node to recover.',
    suggestions: [{ text: 'Check the node condition in the Fleet page' }],
  },
  Unschedulable: {
    code: 'Unschedulable',
    severity: 'broken',
    title: 'No node can run this pod',
    explanation:
      'The scheduler could not find a node with enough resources / matching taints & tolerations / matching affinity.',
    suggestions: [
      { text: 'Check recent events for the specific scheduling constraint that failed', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  FailedScheduling: {
    code: 'FailedScheduling',
    severity: 'broken',
    title: 'Scheduler gave up on this pod',
    explanation:
      'The scheduler tried repeatedly and could not place this pod on any node. Read the event message for the exact constraint that failed.',
    suggestions: [
      { text: 'Check the event message for the failure', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  FailedCreatePodContainer: {
    code: 'FailedCreatePodContainer',
    severity: 'broken',
    title: 'Controller failed to create a pod',
    explanation:
      'The controller (Deployment/StatefulSet/etc.) tried to create a pod and the API rejected the request — usually a quota or validation error.',
    suggestions: [
      { text: 'Check recent events for the exact rejection', action: { type: 'jump_to_tab', tab: 'events' } },
    ],
  },
  ProbeFailed: {
    code: 'ProbeFailed',
    severity: 'degraded',
    title: 'Liveness or readiness probe is failing',
    explanation:
      'The container is running but its readiness or liveness probe is failing. Traffic will not be routed (readiness) or the container will be restarted (liveness).',
    suggestions: [
      { text: 'Check container logs to see why the probe is failing', action: { type: 'jump_to_tab', tab: 'logs' } },
      { text: 'Verify the probe path and port in the YAML', action: { type: 'jump_to_tab', tab: 'yaml' } },
    ],
  },
  PodInitializing: {
    code: 'PodInitializing',
    severity: 'degraded',
    title: 'Pod is still initializing',
    explanation:
      'Init containers are running. The main containers will start once all init containers complete successfully.',
    suggestions: [{ text: 'Wait for init containers to finish' }],
  },
  ContainerCreating: {
    code: 'ContainerCreating',
    severity: 'degraded',
    title: 'Containers are being created',
    explanation:
      'Kubernetes is pulling the image and setting up the container filesystem. Usually takes a few seconds.',
    suggestions: [{ text: 'Wait for the container to finish creating' }],
  },
};

const UNKNOWN_REASON: ReasonCode = {
  code: 'Unknown',
  severity: 'unknown',
  title: 'Unknown state',
  explanation: 'No diagnostic information available.',
  suggestions: [{ text: 'Check recent events' }],
};

/**
 * Look up a reason in the table. Unknown reasons return a generic fallback
 * with severity 'unknown' so the diagnose pipeline never throws.
 */
export function lookupReason(code: string | undefined): ReasonCode {
  if (!code) {
    return UNKNOWN_REASON;
  }
  return (
    REASONS[code] ?? {
      code,
      severity: 'unknown',
      title: `Unknown reason: ${code}`,
      explanation:
        'Kubernetes reported this state without a diagnostic code Kubilitics recognizes. Check recent events and the YAML for details.',
      suggestions: [
        { text: 'Check recent events for more context', action: { type: 'jump_to_tab', tab: 'events' } },
      ],
    }
  );
}
