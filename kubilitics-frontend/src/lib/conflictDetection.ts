/**
 * Conflict detection helpers for Kubernetes resource editing.
 *
 * Kubernetes uses optimistic concurrency via `metadata.resourceVersion`.
 * When a PUT request includes a stale resourceVersion, the API server
 * returns HTTP 409 Conflict. This module provides utilities to detect
 * and handle those conflicts in the frontend.
 */

import { BackendApiError } from '@/services/backendApiClient';

/**
 * Returns `true` if the error represents a Kubernetes 409 Conflict.
 *
 * Handles two code paths:
 * - **Backend mode**: `BackendApiError` with `status === 409`
 * - **Direct K8s mode**: Generic `Error` whose message contains "409"
 *   (thrown by `k8sRequest` as `"Kubernetes API error: 409 - ..."`)
 */
export function isConflictError(error: unknown): boolean {
  if (error instanceof BackendApiError) {
    return error.status === 409;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('409') ||
      msg.includes('conflict') ||
      msg.includes('the object has been modified')
    );
  }

  return false;
}
