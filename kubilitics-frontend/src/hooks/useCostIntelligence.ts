import { useState, useEffect, useCallback, useRef } from 'react';
import { AI_BASE_URL } from '@/services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EfficiencyScore {
  resource_id: string;
  namespace: string;
  kind: string;
  name: string;
  cpu_efficiency_pct: number;
  memory_efficiency_pct: number;
  overall_efficiency_pct: number;
  estimated_monthly_waste_usd: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface Optimization {
  resource_id: string;
  resource_name: string;
  namespace: string;
  type: string;
  description: string;
  current_value: number;
  recommended_value: number;
  savings: number;
  priority: string;
}

export interface CostOverview {
  total_cost_hour: number;
  total_cost_day: number;
  total_cost_month: number;
  total_cost_year: number;
  by_namespace: Record<string, number>;
  by_resource_type: Record<string, number>;
  resource_count: number;
  savings_opportunities: number;
  provider: string;
  top_waste_resources: number;
  top_optimizations: number;
  timestamp: string;
}

export interface NamespaceCost {
  namespace: string;
  cost_per_hour: number;
  cost_per_day: number;
  cost_per_month: number;
  resource_count: number;
  pod_count: number;
  node_count: number;
}

export interface ForecastMonth {
  month: number;
  cost: number;
  lower_95: number;
  upper_95: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'unknown';
  growth_pct: number;
}

export interface CostForecast {
  current_monthly: number;
  forecast_6m: ForecastMonth[];
  timestamp: string;
}

export interface GradeDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface EfficiencyReport {
  efficiencies: EfficiencyScore[];
  total: number;
  grade_distribution: GradeDistribution;
  total_monthly_waste: number;
  timestamp: string;
}

export interface RecommendationsReport {
  recommendations: Optimization[];
  total: number;
  total_savings: number;
  by_type: Record<string, number>;
  timestamp: string;
}

export interface PricingConfig {
  provider: string;
  cpu_price_per_hour: number;
  memory_price_per_gb_hour: number;
  storage_price_per_gb_month: number;
  network_price_per_gb: number;
  lb_price_per_hour: number;
  available_providers: string[];
}

export interface ResourceCostRequest {
  resource_type: 'pod' | 'node' | 'pvc' | 'loadbalancer';
  resource_name: string;
  namespace?: string;
  cpu_cores?: number;
  memory_gb?: number;
  storage_gb?: number;
  network_gb?: number;
  hours_running?: number;
}

export interface ResourceCost {
  resource_id: string;
  resource_name: string;
  resource_type: string;
  namespace: string;
  cost_per_hour: number;
  cost_per_day: number;
  total_cost_month: number;
  breakdown: Record<string, number>;
}

// ─── API base ─────────────────────────────────────────────────────────────────

// Cost intelligence endpoints live on the AI backend (port 8081).
const API_BASE = `${AI_BASE_URL}/api/v1/cost`;

// ─── useCostOverview — polls cluster-wide cost snapshot ───────────────────────

export function useCostOverview(opts: {
  pollIntervalMs?: number;
  enabled?: boolean;
}) {
  const { pollIntervalMs = 30_000, enabled = true } = opts;

  const [data, setData] = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/overview`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: CostOverview = await res.json();
      setData(json);
      setError(null);
      setLastRefreshedAt(new Date());
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetch();
    if (!enabled) return;
    const id = setInterval(fetch, pollIntervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetch, enabled, pollIntervalMs]);

  return { data, loading, error, lastRefreshedAt, refresh: fetch };
}

// ─── useCostNamespaces — fetches per-namespace cost breakdown ─────────────────

export function useCostNamespaces(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;

  const [data, setData] = useState<{ namespaces: NamespaceCost[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/namespaces`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useCostEfficiency — fetches efficiency report ────────────────────────────

export function useCostEfficiency(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;

  const [data, setData] = useState<EfficiencyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/efficiency`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: EfficiencyReport = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useCostRecommendations — fetches ranked optimizations ───────────────────

export function useCostRecommendations(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;

  const [data, setData] = useState<RecommendationsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/recommendations`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: RecommendationsReport = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useCostForecast — fetches 6-month cost forecast ─────────────────────────

export function useCostForecast(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;

  const [data, setData] = useState<CostForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/forecast`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: CostForecast = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useCostPricing — manages pricing configuration ──────────────────────────

export function useCostPricing() {
  const [data, setData] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPricing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/pricing`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PricingConfig = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePricing = useCallback(async (cfg: Partial<PricingConfig>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.fetch(`${API_BASE}/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.pricing);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  return { data, loading, error, refresh: fetchPricing, updatePricing };
}

// ─── useResourceCost — imperative: compute cost for a spec ───────────────────

export function useResourceCost() {
  const [data, setData] = useState<ResourceCost | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compute = useCallback(async (req: ResourceCostRequest) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await window.fetch(`${API_BASE}/resource`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json: ResourceCost = await res.json();
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, compute };
}
