// A-CORE-014: Token budget enforcement hooks — backed by real /api/v1/budget/* endpoints.
// Budget endpoints live on the AI backend (port 8081).
import { useState, useEffect, useCallback } from 'react';
import { AI_BASE_URL } from '@/services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsageSummary {
  user_id: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  by_provider: Record<string, number>;
  by_investigation: Record<string, number>;
  budget_limit_usd: number;
  remaining_usd: number;
  period_start: string;
}

export interface BudgetLimits {
  user_id: string;
  limit_usd: number;
  spent_usd: number;
  remaining_usd: number;
  period_start: string;
  warn_threshold: number;
}

export interface UsageEntry {
  Provider: string;
  InvestigationID: string;
  InputTokens: number;
  OutputTokens: number;
  CostUSD: number;
  Timestamp: string;
}

export interface CostEstimate {
  provider: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_usd: number;
}

export interface BudgetCheckResult {
  available: boolean;
  user_id: string;
  warning?: string;
}

// ─── API base ─────────────────────────────────────────────────────────────────

const API_BASE = `${AI_BASE_URL}/api/v1/budget`;

// ─── useBudgetSummary ─────────────────────────────────────────────────────────

export function useBudgetSummary(userID = 'global', opts: { pollIntervalMs?: number } = {}) {
  const { pollIntervalMs = 30_000 } = opts;
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/summary?user_id=${encodeURIComponent(userID)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchData, pollIntervalMs]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useBudgetLimits ──────────────────────────────────────────────────────────

export function useBudgetLimits(userID = 'global') {
  const [data, setData] = useState<BudgetLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/limits?user_id=${encodeURIComponent(userID)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userID]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const setLimit = useCallback(async (limitUSD: number) => {
    try {
      const res = await window.fetch(`${API_BASE}/limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userID, limit_usd: limitUSD }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchData();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userID, fetchData]);

  return { data, loading, error, refresh: fetchData, setLimit };
}

// ─── useBudgetDetails ────────────────────────────────────────────────────────

export function useBudgetDetails(userID = 'global', investigationID = '') {
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ user_id: userID });
      if (investigationID) params.set('investigation_id', investigationID);
      const res = await window.fetch(`${API_BASE}/details?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setEntries(json.entries ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userID, investigationID]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { entries, loading, error, refresh: fetchData };
}

// ─── useBudgetRecord (imperative) ────────────────────────────────────────────

export function useBudgetRecord() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = useCallback(async (params: {
    userID?: string;
    investigationID?: string;
    inputTokens: number;
    outputTokens: number;
    provider?: string;
  }) => {
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: params.userID ?? 'global',
          investigation_id: params.investigationID ?? '',
          input_tokens: params.inputTokens,
          output_tokens: params.outputTokens,
          provider: params.provider ?? 'openai',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setError(null);
      return json;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, record };
}

// ─── useBudgetEstimate ────────────────────────────────────────────────────────

export function useBudgetEstimate() {
  const [data, setData] = useState<CostEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = useCallback(async (inputTokens: number, outputTokens: number, provider = 'openai') => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        input_tokens: String(inputTokens),
        output_tokens: String(outputTokens),
        provider,
      });
      const res = await window.fetch(`${API_BASE}/estimate?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      return json as CostEstimate;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, estimate };
}

// ─── useBudgetReset (imperative) ────────────────────────────────────────────

export function useBudgetReset() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetBudget = useCallback(async (userID = 'global') => {
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userID }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setError(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, resetBudget };
}
