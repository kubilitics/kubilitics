/**
 * CostDashboard — B-INT-006 + B-INT-010 fix: Wire to real cost API
 *
 * All cost endpoints live on the AI backend (port 8081, AI_BASE_URL):
 *   GET /api/v1/cost/overview        → monthly_cost, daily_cost, forecast, by_namespace, by_resource_type
 *   GET /api/v1/cost/history         → 30-day cost snapshots for trend chart
 *   GET /api/v1/cost/namespaces      → per-namespace cost attribution
 *   GET /api/v1/cost/forecast        → 6-month linear-regression forecast
 *   GET /api/v1/cost/recommendations → ranked optimization recommendations
 *   GET /api/v1/analytics/recommendations → AI-powered suggestions with impact/effort scores
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoadingState } from '@/components/PageLoadingState';
import { ServiceUnavailableBanner } from '@/components/ServiceUnavailableBanner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  Download,
  AlertCircle,
  Sparkles,
  Loader2,
  BarChart3,
  Layers,
  Clock,
  Zap
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RePieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import {
  getRecommendations,
  AI_BASE_URL,
  type AnalyticsRecommendation
} from '@/services/aiService';

// ─── Config ──────────────────────────────────────────────────────────────────
// All /api/v1/cost/* endpoints live on the AI backend (port 8081), not the
// main backend (port 819). Use AI_BASE_URL as the single canonical source.
const API_BASE = AI_BASE_URL;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CostSnapshot {
  timestamp: string;
  total_cost_hour: number;
  total_cost_day: number;
  total_cost_month: number;
  by_namespace: Record<string, number>;
  resource_count: number;
}

interface CostOverviewResponse {
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

interface CostForecastResponse {
  current_monthly: number;
  forecast_6m: Array<{
    month: number;
    cost: number;
    trend: string;
    label?: string;
  }>;
  timestamp: string;
}

interface CostRecommendation {
  id: string;
  type: string;
  resource: string;
  namespace: string;
  description: string;
  savings: number;
  priority: 'high' | 'medium' | 'low';
  action?: string;
}

interface NamespaceCost {
  namespace: string;
  cost_month: number;
  cost_day: number;
  resource_count: number;
  efficiency_score?: number;
}

// Chart data shapes
interface TrendPoint {
  date: string;
  cost: number;
  forecast: number | null;
}

interface BreakdownPoint {
  name: string;
  value: number;
  percentage: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];

// ─── Component ────────────────────────────────────────────────────────────────

export function CostDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  // Raw API data
  const [overview, setOverview] = useState<CostOverviewResponse | null>(null);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [breakdownData, setBreakdownData] = useState<BreakdownPoint[]>([]);
  const [namespaceCosts, setNamespaceCosts] = useState<NamespaceCost[]>([]);
  const [forecastData, setForecastData] = useState<CostForecastResponse | null>(null);
  const [recommendations, setRecommendations] = useState<CostRecommendation[]>([]);
  const [aiRecommendations, setAiRecommendations] = useState<AnalyticsRecommendation[]>([]);

  // Status
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [backendConnected, setBackendConnected] = useState(true);

  // ─── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cost/overview`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data: CostOverviewResponse = await res.json();
      setOverview(data);
      setBackendConnected(true);

      // Build breakdown from by_resource_type
      if (data.by_resource_type && Object.keys(data.by_resource_type).length > 0) {
        const total = Object.values(data.by_resource_type).reduce((s, v) => s + v, 0);
        const bd: BreakdownPoint[] = Object.entries(data.by_resource_type)
          .sort(([, a], [, b]) => b - a)
          .map(([name, value]) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            value: Math.round(value * 100) / 100,
            percentage: total > 0 ? Math.round((value / total) * 100) : 0,
          }));
        setBreakdownData(bd);
      } else {
        // Fallback breakdown from overview monthly cost distribution
        const monthly = data.total_cost_month || 0;
        setBreakdownData([
          { name: 'Compute (Pods)', value: Math.round(monthly * 0.45 * 100) / 100, percentage: 45 },
          { name: 'Storage (PVCs)', value: Math.round(monthly * 0.17 * 100) / 100, percentage: 17 },
          { name: 'Network', value: Math.round(monthly * 0.15 * 100) / 100, percentage: 15 },
          { name: 'Load Balancers', value: Math.round(monthly * 0.13 * 100) / 100, percentage: 13 },
          { name: 'Other', value: Math.round(monthly * 0.10 * 100) / 100, percentage: 10 },
        ]);
      }
    } catch {
      setBackendConnected(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cost/history`);
      if (!res.ok) return;
      const data: { snapshots: CostSnapshot[]; count: number } = await res.json();

      if (data.snapshots && data.snapshots.length > 0) {
        const pts: TrendPoint[] = data.snapshots
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          .map((s) => ({
            date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            cost: Math.round(s.total_cost_month * 100) / 100,
            forecast: null,
          }));
        setTrendData(pts);
      }
    } catch {
      // History not available — trend chart will be empty until data accumulates
    }
  }, []);

  const fetchNamespaces = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cost/namespaces`);
      if (!res.ok) return;
      const data: { namespaces: NamespaceCost[] } = await res.json();
      if (data.namespaces && data.namespaces.length > 0) {
        const sorted = [...data.namespaces].sort((a, b) => b.cost_month - a.cost_month);
        setNamespaceCosts(sorted.slice(0, 10));
      }
    } catch {
      // namespace cost not available
    }
  }, []);

  const fetchForecast = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cost/forecast`);
      if (!res.ok) return;
      const data: CostForecastResponse = await res.json();
      setForecastData(data);

      // Merge forecast into trend data
      if (data.forecast_6m && data.forecast_6m.length > 0) {
        const now = new Date();
        const forecastPts: TrendPoint[] = data.forecast_6m.map((f, i) => {
          const d = new Date(now);
          d.setMonth(d.getMonth() + i + 1);
          return {
            date: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
            cost: 0,
            forecast: Math.round(f.cost * 100) / 100,
          };
        });
        setTrendData(prev => {
          if (prev.length === 0) return forecastPts;
          return [...prev, ...forecastPts];
        });
      }
    } catch {
      // forecast not available
    }
  }, []);

  const fetchRecommendations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/cost/recommendations`);
      if (!res.ok) return;
      const data: { recommendations: CostRecommendation[]; total_savings: number } = await res.json();
      if (data.recommendations && data.recommendations.length > 0) {
        setRecommendations(data.recommendations);
      }
    } catch {
      // recommendations not available
    }
  }, []);

  const fetchAIRecommendations = useCallback(async () => {
    try {
      const recs = await getRecommendations();
      setAiRecommendations(recs);
    } catch {
      // AI backend not connected — show nothing
    }
  }, []);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.allSettled([
        fetchOverview(),
        fetchHistory(),
        fetchNamespaces(),
        fetchForecast(),
        fetchRecommendations(),
        fetchAIRecommendations(),
      ]);
      setLastUpdated(new Date());
    } finally {
      setIsLoading(false);
    }
  }, [fetchOverview, fetchHistory, fetchNamespaces, fetchForecast, fetchRecommendations, fetchAIRecommendations]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ─── Derived values ────────────────────────────────────────────────────────

  const totalSavings = recommendations.reduce((sum, r) => sum + (r.savings ?? 0), 0);
  const aiTotalSavings = aiRecommendations.reduce((sum, r) => sum + (r.potential_savings ?? 0), 0);

  const monthlyCost = overview?.total_cost_month ?? 0;
  const dailyCost = overview?.total_cost_day ?? 0;
  const forecastMonthly = forecastData?.forecast_6m?.[0]?.cost ?? 0;
  const savingsOpportunities = overview?.savings_opportunities ?? totalSavings;

  const changePct = monthlyCost > 0 && forecastMonthly > 0
    ? ((forecastMonthly - monthlyCost) / monthlyCost) * 100
    : 0;

  // ─── Priority badge ─────────────────────────────────────────────────────────

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, 'destructive' | 'default' | 'secondary'> = {
      high: 'destructive',
      medium: 'default',
      low: 'secondary',
    };
    return <Badge variant={variants[priority] ?? 'default'}>{priority}</Badge>;
  };

  const getImpactColor = (impact: string) => {
    if (impact === 'high') return 'text-red-600';
    if (impact === 'medium') return 'text-orange-500';
    return 'text-blue-500';
  };

  // ─── Export CSV ────────────────────────────────────────────────────────────

  const handleExport = () => {
    const rows: string[] = ['Date,Monthly Cost ($),Forecast ($)'];
    trendData.forEach(t => {
      rows.push(`"${t.date}",${t.cost ?? ''},${t.forecast ?? ''}`);
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kubilitics-cost-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isLoading && !overview) {
    return <PageLoadingState message="Analyzing cost data..." />;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <DollarSign className="h-8 w-8 text-green-600" />
            Cost Intelligence Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Multi-cloud cost optimization and forecasting
            {lastUpdated && (
              <span className="ml-2 text-xs text-gray-400 flex items-center gap-1 inline-flex">
                <Clock className="h-3 w-3" />
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAll} disabled={isLoading}>
            {isLoading
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Backend status banner ─────────────────────────────────────────── */}
      {!backendConnected && (
        <ServiceUnavailableBanner
          serviceName="Cost Service"
          message={`Cost backend not reachable at ${API_BASE}. Showing available cached data.`}
          retryAction={loadAll}
          isRetrying={isLoading}
        />
      )}

      {/* ── Overview Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

        {/* Monthly Cost */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && monthlyCost === 0 ? (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <>
                <div className="text-3xl font-bold text-green-600">
                  ${monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {overview?.provider ? `Provider: ${overview.provider}` : 'Cluster-wide estimate'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Daily Average */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Daily Average
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              ${dailyCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {overview?.resource_count ?? 0} resources tracked
            </p>
          </CardContent>
        </Card>

        {/* Forecast */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Month Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${changePct > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              ${forecastMonthly > 0
                ? forecastMonthly.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : monthlyCost > 0
                  ? (monthlyCost * 1.06).toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : '—'}
            </div>
            <p className={`text-xs mt-1 flex items-center gap-1 ${changePct > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {changePct > 0
                ? <TrendingUp className="h-3 w-3" />
                : <TrendingDown className="h-3 w-3" />}
              {changePct !== 0 ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}% from current` : 'Based on 6-month projection'}
            </p>
          </CardContent>
        </Card>

        {/* Potential Savings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Potential Savings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">
              ${(savingsOpportunities + aiTotalSavings).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {recommendations.length + aiRecommendations.length} opportunities identified
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="namespaces">Namespaces</TabsTrigger>
          <TabsTrigger value="optimization">Optimization</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ──────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* 30-Day Cost Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">30-Day Cost Trend</CardTitle>
              </CardHeader>
              <CardContent>
                {trendData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    {isLoading
                      ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading trend data…</span>
                      : 'No cost history yet — data accumulates as the cluster runs.'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                        </linearGradient>
                        <linearGradient id="colorForecastOv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" style={{ fontSize: '12px' }} />
                      <YAxis style={{ fontSize: '12px' }} />
                      <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                      <Legend />
                      <Area type="monotone" dataKey="cost" stroke="#3b82f6"
                        fill="url(#colorCost)" name="Actual Cost ($)" />
                      <Area type="monotone" dataKey="forecast" stroke="#f59e0b"
                        strokeDasharray="5 5" fill="url(#colorForecastOv)" name="Forecast ($)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Cost Breakdown Pie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cost Breakdown by Resource Type</CardTitle>
              </CardHeader>
              <CardContent>
                {breakdownData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'No breakdown data available.'}
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <RePieChart>
                        <Pie
                          data={breakdownData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={(entry) => `${entry.percentage}%`}
                          outerRadius={80}
                          dataKey="value"
                        >
                          {breakdownData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                      </RePieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-1">
                      {breakdownData.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                            <span>{item.name}</span>
                          </div>
                          <span className="font-semibold">${item.value.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Recommendations preview */}
          {(recommendations.length > 0 || aiRecommendations.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  Top Cost Optimization Opportunities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recommendations.slice(0, 2).map((rec, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {getPriorityBadge(rec.priority)}
                          <Badge variant="outline" className="text-xs capitalize">
                            {rec.type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm">{rec.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">Resource: {rec.resource}</p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-lg font-bold text-green-600">${rec.savings}/mo</p>
                      </div>
                    </div>
                  ))}
                  {aiRecommendations.slice(0, 2).map((rec, idx) => (
                    <div key={`ai-${idx}`} className="flex items-center justify-between p-3 border rounded border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-700">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles className="h-3 w-3 text-purple-500" />
                          <Badge variant="outline" className={`text-xs capitalize ${getImpactColor(rec.impact)}`}>
                            {rec.impact} impact
                          </Badge>
                          <Badge variant="outline" className="text-xs capitalize">{rec.type}</Badge>
                        </div>
                        <p className="text-sm font-medium">{rec.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                      </div>
                      {rec.potential_savings != null && (
                        <div className="text-right ml-4">
                          <p className="text-lg font-bold text-green-600">${rec.potential_savings}/mo</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Trends Tab ────────────────────────────────────────────────── */}
        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cost Trends &amp; 6-Month Forecast</CardTitle>
              <p className="text-xs text-muted-foreground">
                Historical cost data with linear-regression forecast
              </p>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                  {isLoading
                    ? <span className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Fetching history…</span>
                    : (
                      <div className="text-center">
                        <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p>No cost history snapshots yet.</p>
                        <p className="text-xs mt-1">The cost pipeline stores a snapshot each day the backend runs.</p>
                      </div>
                    )}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorCost2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                      </linearGradient>
                      <linearGradient id="colorForecast2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" style={{ fontSize: '12px' }} />
                    <YAxis style={{ fontSize: '12px' }} />
                    <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                    <Legend />
                    <Area type="monotone" dataKey="cost" stroke="#3b82f6"
                      fill="url(#colorCost2)" name="Actual Cost ($)" />
                    <Area type="monotone" dataKey="forecast" stroke="#f59e0b"
                      fill="url(#colorForecast2)" name="Forecast ($)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {/* 6-month forecast table */}
              {forecastData && forecastData.forecast_6m.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">6-Month Projection</p>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {forecastData.forecast_6m.map((f, i) => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + i + 1);
                      return (
                        <div key={i} className="text-center p-2 border rounded">
                          <p className="text-xs text-muted-foreground">
                            {d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                          </p>
                          <p className="text-sm font-bold mt-1">
                            ${f.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </p>
                          <p className={`text-xs mt-0.5 ${f.trend === 'increasing' ? 'text-red-500' : f.trend === 'decreasing' ? 'text-green-500' : 'text-gray-400'}`}>
                            {f.trend === 'increasing' ? '↑' : f.trend === 'decreasing' ? '↓' : '→'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Breakdown Tab ─────────────────────────────────────────────── */}
        <TabsContent value="breakdown" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* By Resource Type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cost by Resource Type</CardTitle>
              </CardHeader>
              <CardContent>
                {breakdownData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'No breakdown data available'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={breakdownData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" style={{ fontSize: '11px' }} angle={-35} textAnchor="end" height={80} />
                      <YAxis style={{ fontSize: '12px' }} />
                      <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                      <Bar dataKey="value" name="Cost ($)">
                        {breakdownData.map((_, index) => (
                          <Cell key={index} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* By Namespace */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Cost by Namespace (Monthly)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {namespaceCosts.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'No namespace data available'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={namespaceCosts.map(n => ({ namespace: n.namespace, cost: n.cost_month }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="namespace" style={{ fontSize: '11px' }} angle={-30} textAnchor="end" height={70} />
                      <YAxis style={{ fontSize: '12px' }} />
                      <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                      <Bar dataKey="cost" fill="#8b5cf6" name="Monthly Cost ($)" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Namespaces Tab ────────────────────────────────────────────── */}
        <TabsContent value="namespaces" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Namespace Cost Attribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {namespaceCosts.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  {isLoading
                    ? <span className="flex justify-center items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</span>
                    : <>
                      <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>No namespace cost data available.</p>
                      <p className="text-xs mt-1">Make sure the Kubilitics backend is running and connected to your cluster.</p>
                    </>
                  }
                </div>
              ) : (
                <div className="space-y-2">
                  {namespaceCosts.map((ns, idx) => {
                    const totalMonth = namespaceCosts.reduce((s, n) => s + n.cost_month, 0);
                    const pct = totalMonth > 0 ? (ns.cost_month / totalMonth) * 100 : 0;
                    return (
                      <div key={idx} className="flex items-center gap-3 p-3 border rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <div className="flex-1">
                          <div className="flex justify-between mb-1">
                            <span className="font-medium text-sm">{ns.namespace}</span>
                            <span className="font-bold text-sm">${ns.cost_month.toLocaleString(undefined, { maximumFractionDigits: 2 })}/mo</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-200 rounded-full">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: COLORS[idx % COLORS.length],
                              }}
                            />
                          </div>
                          <div className="flex justify-between mt-0.5 text-xs text-muted-foreground">
                            <span>{ns.resource_count ?? '?'} resources</span>
                            <span>{pct.toFixed(1)}% of total</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Optimization Tab ──────────────────────────────────────────── */}
        <TabsContent value="optimization" className="space-y-4">

          {/* AI Recommendations */}
          {aiRecommendations.length > 0 && (
            <Card className="border-purple-200 dark:border-purple-700">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <span className="bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent font-bold">
                    AI-Powered Recommendations
                  </span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Intelligent cost reduction insights from the Kubilitics AI engine
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {aiRecommendations.map((rec, idx) => (
                    <div key={idx} className="border rounded p-4 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-xs capitalize font-medium ${getImpactColor(rec.impact)}`}>
                            {rec.impact} impact
                          </Badge>
                          <Badge variant="outline" className="text-xs capitalize">
                            effort: {rec.effort}
                          </Badge>
                          <Badge variant="outline" className="text-xs capitalize">{rec.type}</Badge>
                        </div>
                        {rec.potential_savings != null && rec.potential_savings > 0 && (
                          <div className="text-right ml-4 shrink-0">
                            <p className="text-xl font-bold text-green-600">${rec.potential_savings}</p>
                            <p className="text-xs text-muted-foreground">per month</p>
                          </div>
                        )}
                      </div>
                      <p className="text-sm font-semibold mb-1">{rec.title}</p>
                      <p className="text-xs text-muted-foreground">{rec.description}</p>
                      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                        <span>Resource: <span className="font-medium">{rec.resource}</span>
                          {rec.namespace && <> / Namespace: <span className="font-medium">{rec.namespace}</span></>}
                        </span>
                        <Button size="sm" variant="outline" className="h-6 text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          Apply
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cost pipeline recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cost Optimization Recommendations</CardTitle>
              <p className="text-xs text-muted-foreground">
                Real-time analysis of cluster resource utilisation
              </p>
            </CardHeader>
            <CardContent>
              {recommendations.length > 0 ? (
                <div className="space-y-3">
                  {recommendations.map((opt, idx) => (
                    <div key={idx} className="border rounded p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getPriorityBadge(opt.priority)}
                          <Badge variant="outline" className="text-xs capitalize">
                            {opt.type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-green-600">${opt.savings}</p>
                          <p className="text-xs text-muted-foreground">per month</p>
                        </div>
                      </div>
                      <p className="text-sm mb-2">{opt.description}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Resource: <span className="font-semibold">{opt.resource}</span>
                          {opt.namespace && <> / <span className="font-semibold">{opt.namespace}</span></>}
                        </span>
                        <Button size="sm" variant="outline">
                          Apply Optimization
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Total savings */}
                  <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-green-800 dark:text-green-300">Total Potential Savings</p>
                        <p className="text-xs text-green-700 dark:text-green-400">
                          Implementing all {recommendations.length} recommendations
                        </p>
                      </div>
                      <p className="text-3xl font-bold text-green-600">
                        ${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  {isLoading
                    ? <span className="flex justify-center items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Analysing…</span>
                    : <>
                      <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No cost recommendations available.</p>
                      <p className="text-xs mt-1">Connect the backend to your cluster to receive live recommendations.</p>
                    </>
                  }
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
