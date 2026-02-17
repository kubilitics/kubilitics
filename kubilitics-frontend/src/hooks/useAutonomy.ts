/**
 * useAutonomy — hook for safety engine: autonomy levels, policies, rules.
 *
 * Covers:
 *   GET  /api/v1/safety/rules                                 - immutable rules
 *   GET  /api/v1/safety/policies                              - list policies
 *   POST /api/v1/safety/policies                              - create policy
 *   DELETE /api/v1/safety/policies/{name}                     - delete policy
 *   GET  /api/v1/safety/autonomy/{user_id}                    - get autonomy level
 *   POST /api/v1/safety/autonomy/{user_id}                    - set autonomy level
 *   GET  /api/v1/safety/autonomy/{user_id}/namespaces         - list ns overrides
 *   POST /api/v1/safety/autonomy/{user_id}/namespaces         - upsert ns override
 *   DELETE /api/v1/safety/autonomy/{user_id}/namespaces/{ns}  - delete ns override
 *   GET  /api/v1/safety/approvals                             - list approvals
 *   POST /api/v1/safety/approvals/{id}/approve                - approve action
 *   POST /api/v1/safety/approvals/{id}/reject                 - reject action
 *   POST /api/v1/safety/evaluate                              - evaluate an action
 */

import { useState, useCallback, useEffect } from 'react';
import { AI_BASE_URL } from '../services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SafetyRule {
  name?: string;
  description?: string;
}

export interface SafetyPolicy {
  name: string;
  condition: string;
  effect: 'deny' | 'warn';
  reason: string;
}

export interface PolicyCheck {
  policy_name: string;
  passed: boolean;
  reason: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface SafetyEvaluationResult {
  approved: boolean;
  result: 'approve' | 'deny' | 'request_approval' | 'warn';
  reason: string;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  blast_radius?: {
    affected_resources: unknown[];
    impact_summary: string;
  };
  requires_human: boolean;
  policy_checks: PolicyCheck[];
  metadata: Record<string, unknown>;
}

export interface SafetyAction {
  id?: string;
  operation: string;
  resource_type: string;
  resource_name: string;
  namespace: string;
  target_state?: Record<string, unknown>;
  justification?: string;
  user_id?: string;
}

// Autonomy level definitions matching backend
export const AUTONOMY_LEVELS = [
  {
    level: 0,
    name: 'Observatory',
    label: 'Observe Only',
    description: 'Read-only mode. No actions allowed — observe and report.',
    color: 'text-slate-400',
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    icon: '👁',
  },
  {
    level: 1,
    name: 'Recommend',
    label: 'Recommendations',
    description: 'AI suggests actions. Safe operations (restarts) are auto-executed; risky ones require your approval.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: '💡',
  },
  {
    level: 2,
    name: 'Propose',
    label: 'Semi-Autonomous',
    description: 'Scale and rollback auto-execute. Destructive operations (delete, drain) require approval.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    icon: '🤖',
  },
  {
    level: 3,
    name: 'ActWithGuard',
    label: 'Act with Guard',
    description: 'Most operations auto-execute. Only drain and delete require human approval.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: '⚡',
  },
  {
    level: 4,
    name: 'FullAutonomous',
    label: 'Full Autonomous',
    description: 'All policy-approved operations execute automatically. Use with extreme caution.',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: '🔥',
  },
] as const;

// ─── API helpers ──────────────────────────────────────────────────────────────

async function safetyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${AI_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function safetyPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AI_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function safetyDelete(path: string): Promise<void> {
  const res = await fetch(`${AI_BASE_URL}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
}

// ─── useImmutableRules ────────────────────────────────────────────────────────

export function useImmutableRules() {
  const [rules, setRules] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safetyGet<{ rules: string[] } | string[]>('/api/v1/safety/rules');
      const arr = Array.isArray(data)
        ? (data as string[])
        : ((data as { rules: string[] }).rules ?? []);
      setRules(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { rules, loading, error, reload: load };
}

// ─── useSafetyPolicies ────────────────────────────────────────────────────────

export function useSafetyPolicies() {
  const [policies, setPolicies] = useState<SafetyPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safetyGet<{ policies: SafetyPolicy[] } | SafetyPolicy[]>('/api/v1/safety/policies');
      const arr = Array.isArray(data)
        ? (data as SafetyPolicy[])
        : ((data as { policies: SafetyPolicy[] }).policies ?? []);
      setPolicies(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createPolicy = useCallback(async (policy: SafetyPolicy) => {
    setSaving(true);
    try {
      await safetyPost('/api/v1/safety/policies', policy);
      await load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  const deletePolicy = useCallback(async (name: string) => {
    setSaving(true);
    try {
      await safetyDelete(`/api/v1/safety/policies/${encodeURIComponent(name)}`);
      await load();
    } finally {
      setSaving(false);
    }
  }, [load]);

  return { policies, loading, error, saving, createPolicy, deletePolicy, reload: load };
}

// ─── useAutonomyLevel ─────────────────────────────────────────────────────────

export function useAutonomyLevel(userID = 'default') {
  const [level, setLevelState] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safetyGet<{ user_id: string; level: number }>(`/api/v1/safety/autonomy/${encodeURIComponent(userID)}`);
      setLevelState(data.level ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => { load(); }, [load]);

  const setLevel = useCallback(async (newLevel: number) => {
    setSaving(true);
    setError(null);
    try {
      await safetyPost(`/api/v1/safety/autonomy/${encodeURIComponent(userID)}`, { level: newLevel });
      setLevelState(newLevel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [userID]);

  return { level, loading, error, saving, setLevel, reload: load };
}

// ─── useSafetyEvaluate ────────────────────────────────────────────────────────

export function useSafetyEvaluate() {
  const [result, setResult] = useState<SafetyEvaluationResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluate = useCallback(async (action: SafetyAction) => {
    setEvaluating(true);
    setError(null);
    setResult(null);
    try {
      const data = await safetyPost<SafetyEvaluationResult>('/api/v1/safety/evaluate', {
        action: action.operation,
        context: action,
      });
      setResult(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setEvaluating(false);
    }
  }, []);

  return { result, evaluating, error, evaluate };
}

// ─── Namespace overrides ──────────────────────────────────────────────────────

export interface NamespaceOverride {
  user_id: string;
  namespace: string;
  level: number;
  updated_at: string;
}

export function useNamespaceOverrides(userID = 'default') {
  const [overrides, setOverrides] = useState<NamespaceOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await safetyGet<{ overrides: NamespaceOverride[] }>(
        `/api/v1/safety/autonomy/${encodeURIComponent(userID)}/namespaces`,
      );
      setOverrides(Array.isArray(data.overrides) ? data.overrides : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => { load(); }, [load]);

  const upsert = useCallback(async (namespace: string, level: number) => {
    setSaving(true);
    setError(null);
    try {
      await safetyPost(`/api/v1/safety/autonomy/${encodeURIComponent(userID)}/namespaces`, {
        namespace,
        level,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [userID, load]);

  const remove = useCallback(async (namespace: string) => {
    setSaving(true);
    setError(null);
    try {
      await fetch(`${AI_BASE_URL}/api/v1/safety/autonomy/${encodeURIComponent(userID)}/namespaces/${encodeURIComponent(namespace)}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [userID, load]);

  return { overrides, loading, error, saving, upsert, remove, reload: load };
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export interface PendingApproval {
  id: string;
  user_id: string;
  operation: string;
  namespace?: string;
  resource_id?: string;
  description: string;
  risk_level: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
  metadata?: Record<string, unknown>;
}

export function useApprovals(userID = 'default', autoRefreshMs = 15_000) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = userID
        ? `/api/v1/safety/approvals?user_id=${encodeURIComponent(userID)}`
        : '/api/v1/safety/approvals';
      const data = await safetyGet<{ approvals: PendingApproval[] }>(url);
      const list = Array.isArray(data.approvals) ? data.approvals : [];
      setApprovals(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => {
    load();
    if (autoRefreshMs > 0) {
      const id = setInterval(load, autoRefreshMs);
      return () => clearInterval(id);
    }
  }, [load, autoRefreshMs]);

  const approve = useCallback(async (actionID: string) => {
    setActing(true);
    setError(null);
    try {
      await safetyPost(
        `/api/v1/safety/approvals/${encodeURIComponent(actionID)}/approve?user_id=${encodeURIComponent(userID)}`,
        {},
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }, [userID, load]);

  const reject = useCallback(async (actionID: string) => {
    setActing(true);
    setError(null);
    try {
      await safetyPost(
        `/api/v1/safety/approvals/${encodeURIComponent(actionID)}/reject?user_id=${encodeURIComponent(userID)}`,
        {},
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  }, [userID, load]);

  const pendingCount = approvals.filter(a => a.status === 'pending').length;

  return { approvals, pendingCount, loading, error, acting, approve, reject, reload: load };
}
