/**
 * Shared fake Kubernetes resources used by diagnose tests. Each factory
 * returns a minimal object with exactly the fields the diagnose pipeline
 * reads — no more. Keeps tests small and focused.
 */

/**
 * Healthy pod with one completed init container and two running regular
 * containers — mirrors the real aws-node-hpd64 pod shape (EKS CNI
 * DaemonSet): init container finishes setup with exit 0, main containers
 * are running and ready. Used to verify diagnosePod's healthy oneLine
 * matches kubectl's READY 2/2 semantics (init containers NOT counted).
 */
export function healthyPodWithInit(name = 'aws-node') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'kube-system', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Running',
      initContainerStatuses: [
        {
          name: 'aws-vpc-cni-init',
          ready: false,
          restartCount: 0,
          state: {
            terminated: { reason: 'Completed', exitCode: 0, finishedAt: '2026-04-14T10:00:00Z' },
          },
        },
      ],
      containerStatuses: [
        {
          name: 'aws-node',
          ready: true,
          restartCount: 0,
          state: { running: { startedAt: '2026-04-14T10:00:05Z' } },
        },
        {
          name: 'aws-eks-nodeagent',
          ready: true,
          restartCount: 0,
          state: { running: { startedAt: '2026-04-14T10:00:05Z' } },
        },
      ],
      conditions: [
        { type: 'Initialized', status: 'True' },
        { type: 'Ready', status: 'True' },
        { type: 'ContainersReady', status: 'True' },
        { type: 'PodScheduled', status: 'True' },
      ],
    },
  };
}

export function crashLoopPod(name = 'busybox-pod') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Pending',
      containerStatuses: [
        {
          name: 'busybox',
          ready: false,
          restartCount: 5,
          state: { waiting: { reason: 'CrashLoopBackOff', message: 'Back-off 40s restarting failed container' } },
          lastState: {
            terminated: {
              reason: 'StartError',
              message:
                'failed to create containerd task: exec: "invalid-command-that-does-not-exist": executable file not found in $PATH',
              exitCode: 128,
              finishedAt: '2026-04-14T12:31:10Z',
            },
          },
        },
      ],
      conditions: [
        { type: 'Initialized', status: 'True' },
        { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
        { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady' },
        { type: 'PodScheduled', status: 'True' },
      ],
    },
  };
}

export function healthyPod(name = 'nginx') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Running',
      containerStatuses: [
        {
          name: 'nginx',
          ready: true,
          restartCount: 0,
          state: { running: { startedAt: '2026-04-14T10:00:00Z' } },
        },
      ],
      conditions: [
        { type: 'Initialized', status: 'True' },
        { type: 'Ready', status: 'True' },
        { type: 'ContainersReady', status: 'True' },
        { type: 'PodScheduled', status: 'True' },
      ],
    },
  };
}

export function oomKilledPod(name = 'hungry') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Running',
      containerStatuses: [
        {
          name: 'app',
          ready: false,
          restartCount: 2,
          state: { waiting: { reason: 'CrashLoopBackOff' } },
          lastState: {
            terminated: {
              reason: 'OOMKilled',
              exitCode: 137,
              finishedAt: '2026-04-14T12:31:10Z',
            },
          },
        },
      ],
      conditions: [],
    },
  };
}

export function imagePullPod(name = 'bad-image') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Pending',
      containerStatuses: [
        {
          name: 'app',
          ready: false,
          restartCount: 0,
          state: {
            waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image "nonexistent:latest"' },
          },
        },
      ],
      conditions: [],
    },
  };
}

export function schedulingFailedPod(name = 'no-node') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Pending',
      containerStatuses: [],
      conditions: [
        {
          type: 'PodScheduled',
          status: 'False',
          reason: 'Unschedulable',
          message: "0/3 nodes are available: 3 Insufficient cpu.",
        },
      ],
    },
  };
}

export function unreadyPod(name = 'slow-starter') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Running',
      containerStatuses: [
        {
          name: 'app',
          ready: false,
          restartCount: 0,
          state: { running: { startedAt: '2026-04-14T10:00:00Z' } },
        },
      ],
      conditions: [
        { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
      ],
    },
  };
}

export function initContainerFailingPod(name = 'bad-init') {
  return {
    kind: 'Pod',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    status: {
      phase: 'Pending',
      initContainerStatuses: [
        {
          name: 'init-setup',
          ready: false,
          restartCount: 3,
          state: { waiting: { reason: 'CrashLoopBackOff' } },
          lastState: {
            terminated: { reason: 'Error', exitCode: 1, message: 'init failed' },
          },
        },
      ],
      containerStatuses: [
        {
          name: 'app',
          ready: false,
          restartCount: 0,
          state: { waiting: { reason: 'PodInitializing' } },
        },
      ],
      conditions: [{ type: 'Initialized', status: 'False' }],
    },
  };
}

export function runningDeployment(name = 'web', replicas = 3) {
  return {
    kind: 'Deployment',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    spec: {
      replicas,
      selector: { matchLabels: { app: name } },
    },
    status: {
      replicas,
      readyReplicas: replicas,
      availableReplicas: replicas,
    },
  };
}

export function brokenDeployment(name = 'web') {
  return {
    kind: 'Deployment',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    spec: {
      replicas: 3,
      selector: { matchLabels: { app: name } },
    },
    status: {
      replicas: 3,
      readyReplicas: 2,
      availableReplicas: 2,
    },
  };
}

export function completedJob(name = 'migration') {
  return {
    kind: 'Job',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    spec: { completions: 1, backoffLimit: 6 },
    status: {
      succeeded: 1,
      active: 0,
      conditions: [{ type: 'Complete', status: 'True' }],
    },
  };
}

export function failedJob(name = 'migration') {
  return {
    kind: 'Job',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    spec: { completions: 1, backoffLimit: 6 },
    status: {
      succeeded: 0,
      failed: 7,
      active: 0,
      conditions: [{ type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded' }],
    },
  };
}

export function suspendedCronJob(name = 'nightly') {
  return {
    kind: 'CronJob',
    metadata: { name, namespace: 'default', uid: `uid-${name}`, resourceVersion: '1' },
    spec: { schedule: '0 0 * * *', suspend: true },
    status: { active: [] },
  };
}

export function warningEvent(reason: string, message: string, count = 1) {
  return {
    reason,
    message,
    count,
    type: 'Warning',
    first_seen: 1_700_000_000_000,
    last_seen: 1_700_000_060_000,
    involvedObject: { kind: 'Pod', namespace: 'default', name: 'wrong-container-command-pod' },
  };
}
