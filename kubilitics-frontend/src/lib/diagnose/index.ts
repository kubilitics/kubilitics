import type { Diagnosis, DiagnoseOptions } from './types';
import { diagnosePod } from './podDiagnosis';
import { diagnoseController } from './controllerDiagnosis';
import { diagnoseJob } from './jobDiagnosis';
import { diagnoseCronJob } from './cronJobDiagnosis';

export type {
  Diagnosis,
  DiagnosisSeverity,
  ReasonCode,
  Suggestion,
  DiagnoseAction,
  ContainerDiagnosis,
  WarningEvent,
  PodCondition,
  DiagnoseOptions,
} from './types';
export { REASONS, lookupReason } from './reasons';
export { diagnosePod, diagnoseController, diagnoseJob, diagnoseCronJob };

/**
 * Single entrypoint for diagnosing any workload resource. Dispatches to the
 * specific diagnose function based on resource.kind.
 *
 * For Pod: only `events` is used from options.
 * For Deployment/StatefulSet/DaemonSet/ReplicaSet: `relatedPods` + `events`.
 * For Job: `relatedPods` + `events`.
 * For CronJob: `relatedJobs` + `events`.
 */
export function diagnoseWorkload(
  resource: { kind?: string; metadata: { name: string; namespace?: string } } & Record<string, unknown>,
  options: DiagnoseOptions = {}
): Diagnosis {
  const events = (options.events ?? []) as Parameters<typeof diagnosePod>[1];
  const pods = (options.relatedPods ?? []) as Parameters<typeof diagnoseController>[1];
  const jobs = (options.relatedJobs ?? []) as Parameters<typeof diagnoseCronJob>[1];

  switch (resource.kind) {
    case 'Pod':
      return diagnosePod(resource as Parameters<typeof diagnosePod>[0], events);
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'ReplicaSet':
      return diagnoseController(resource as Parameters<typeof diagnoseController>[0], pods, events);
    case 'Job':
      return diagnoseJob(resource as Parameters<typeof diagnoseJob>[0], pods, events);
    case 'CronJob':
      return diagnoseCronJob(resource as Parameters<typeof diagnoseCronJob>[0], jobs, events);
    default:
      return {
        severity: 'unknown',
        headline: `Kubilitics cannot diagnose ${resource.kind ?? 'unknown'} resources`,
        oneLine: 'This resource type is not supported by the diagnose panel.',
        reasons: [],
        containers: [],
        conditions: [],
        recentWarnings: events,
        computedAt: Date.now(),
        kind: resource.kind ?? 'Unknown',
        namespace: resource.metadata?.namespace,
        name: resource.metadata?.name ?? 'unknown',
      };
  }
}
