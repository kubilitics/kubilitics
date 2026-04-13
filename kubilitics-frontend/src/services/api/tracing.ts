/**
 * Tracing API client — query agent status and per-deployment instrumentation state.
 *
 * Mutation functions (enableTracing, instrumentDeployment, uninstrumentDeployment,
 * installOperator) were removed. The install flow now lives in the dedicated
 * Observability Setup page (/clusters/:id/setup/observability). Per-deployment
 * instrumentation is now a read-only command display via observability.ts.
 */
import { backendRequest } from './client';

export interface DeploymentInfo {
  name: string;
  namespace: string;
  image: string;
  detected_language: string;
  replicas: number;
  instrumented: boolean;
}

export interface TracingStatus {
  enabled: boolean;
  agent_healthy: boolean;
  agent_span_count: number;
  instrumented_deployments: string[];
  available_deployments: DeploymentInfo[];
  // NEW: operator lifecycle (backend may not yet return these)
  agent_deployed?: boolean;
  operator_state?: 'not_installed' | 'installing' | 'ready' | 'failed';
  operator_message?: string;
}

export interface ContainerInstrumentation {
  name: string;
  image: string;
  detected_language: string;
  confidence: 'high' | 'medium' | 'low';
  detection_source: 'command' | 'env' | 'image-label' | 'image-name' | 'none';
  supports_auto: boolean;
  instrumented: boolean;
}

export interface PreflightCheck {
  name: string;
  severity: 'blocking' | 'warning' | 'info';
  passed: boolean;
  message: string;
  detail?: string;
}

export interface PreflightChecks {
  passed: boolean;
  checks: PreflightCheck[];
}

export async function getTracingStatus(
  baseUrl: string,
  clusterId: string,
): Promise<TracingStatus> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/status`,
  );
}

/**
 * @deprecated Use the Observability Setup page (/clusters/:id/setup/observability)
 * with the generated helm install command instead of this one-click mutation.
 * Kept only to avoid breaking TracingSetup.tsx until that dialog is retired.
 */
export async function enableTracing(
  baseUrl: string,
  clusterId: string,
): Promise<{ status: string; message: string }> {
  return backendRequest(
    baseUrl,
    `clusters/${encodeURIComponent(clusterId)}/tracing/enable`,
    { method: 'POST' },
  );
}
