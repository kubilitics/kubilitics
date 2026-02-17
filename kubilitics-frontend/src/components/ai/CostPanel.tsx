import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Layers,
  Award,
  AlertCircle,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Cpu,
  HardDrive,
  BarChart2,
  Zap,
} from 'lucide-react';
import {
  useCostOverview,
  useCostNamespaces,
  useCostEfficiency,
  useCostForecast,
  useCostRecommendations,
  type EfficiencyScore,
  type ForecastMonth,
  type NamespaceCost,
  type Optimization,
} from '../../hooks/useCostIntelligence';

// ─── Types ────────────────────────────────────────────────────────────────────

type CostTab = 'overview' | 'namespaces' | 'efficiency' | 'forecast';

// ─── Shared Helpers ───────────────────────────────────────────────────────────

function fmt$(v: number, decimals = 2): string {
  return `$${v.toFixed(decimals)}`;
}

function fmtK$(v: number): string {
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return fmt$(v, 2);
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return 'text-emerald-400';
    case 'B': return 'text-green-400';
    case 'C': return 'text-yellow-400';
    case 'D': return 'text-orange-400';
    case 'F': return 'text-red-400';
    default: return 'text-slate-400';
  }
}

function gradeBg(grade: string): string {
  switch (grade) {
    case 'A': return 'bg-emerald-500/10 border-emerald-500/30';
    case 'B': return 'bg-green-500/10 border-green-500/30';
    case 'C': return 'bg-yellow-500/10 border-yellow-500/30';
    case 'D': return 'bg-orange-500/10 border-orange-500/30';
    case 'F': return 'bg-red-500/10 border-red-500/30';
    default: return 'bg-slate-500/10 border-slate-500/30';
  }
}

function trendIcon(trend: string) {
  if (trend === 'increasing') return <ArrowUpRight className="h-3.5 w-3.5 text-red-400" />;
  if (trend === 'decreasing') return <ArrowDownRight className="h-3.5 w-3.5 text-emerald-400" />;
  return <Minus className="h-3.5 w-3.5 text-slate-400" />;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

// ─── Efficiency Arc Gauge ─────────────────────────────────────────────────────

function EfficiencyGauge({ value, grade }: { value: number; grade: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const stroke = (value / 100) * circ * 0.75; // 270° arc
  const colors: Record<string, string> = {
    A: '#10b981', B: '#22c55e', C: '#eab308', D: '#f97316', F: '#ef4444',
  };
  const color = colors[grade] ?? '#64748b';

  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="rotate-[135deg]">
      <circle cx="28" cy="28" r={r} fill="none" stroke="#1e293b" strokeWidth="5"
        strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeLinecap="round" />
      <motion.circle
        cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${stroke} ${circ}`}
        initial={{ strokeDasharray: `0 ${circ}` }}
        animate={{ strokeDasharray: `${stroke} ${circ}` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </svg>
  );
}

// ─── Cost Metric Card ─────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, iconClass = 'text-violet-400',
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconClass?: string;
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 flex items-start gap-3">
      <div className={`mt-0.5 ${iconClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className="text-base font-semibold text-white truncate">{value}</p>
        {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

const TABS: { id: CostTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview',    label: 'Overview',    icon: DollarSign },
  { id: 'namespaces',  label: 'Namespaces',  icon: Layers },
  { id: 'efficiency',  label: 'Efficiency',  icon: Award },
  { id: 'forecast',    label: 'Forecast',    icon: TrendingUp },
];

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, loading, error, lastRefreshedAt, refresh } = useCostOverview({ pollIntervalMs: 30_000 });

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 text-violet-400 animate-spin mr-2" />
        <span className="text-sm text-slate-400">Fetching cost data…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm p-4">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!data) return null;

  // Resource type breakdown bar chart (simple)
  const byType = data.by_resource_type ?? {};
  const typeTotal = Object.values(byType).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Top metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="/ Hour"  value={fmt$(data.total_cost_hour, 4)}  icon={DollarSign} iconClass="text-violet-400" />
        <MetricCard label="/ Day"   value={fmtK$(data.total_cost_day)}      icon={BarChart2}  iconClass="text-blue-400" />
        <MetricCard label="/ Month" value={fmtK$(data.total_cost_month)}    icon={TrendingUp} iconClass="text-emerald-400" />
        <MetricCard label="/ Year"  value={fmtK$(data.total_cost_year)}     icon={Zap}        iconClass="text-yellow-400" />
      </div>

      {/* Savings banner */}
      {data.savings_opportunities > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 flex items-center gap-2"
        >
          <Zap className="h-4 w-4 text-emerald-400 shrink-0" />
          <div>
            <p className="text-xs font-medium text-emerald-300">
              {fmtK$(data.savings_opportunities)} / month in savings opportunities
            </p>
            <p className="text-xs text-slate-400">
              {data.top_optimizations} recommendations across {data.top_waste_resources} resources
            </p>
          </div>
        </motion.div>
      )}

      {/* Resource type breakdown */}
      {typeTotal > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">By Resource Type</p>
          {Object.entries(byType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, hourCost]) => {
              const pctWidth = typeTotal > 0 ? (hourCost / typeTotal) * 100 : 0;
              return (
                <div key={type} className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 capitalize">{type}</span>
                    <span className="text-slate-400">{fmtK$(hourCost * 24 * 30)}/mo</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-violet-500 rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${pctWidth}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Provider: <span className="text-slate-300 capitalize">{data.provider}</span></span>
        <span>
          {data.resource_count} resources
          {lastRefreshedAt && ` · ${lastRefreshedAt.toLocaleTimeString()}`}
        </span>
        <button
          onClick={refresh}
          className="flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}

// ─── Namespaces Tab ───────────────────────────────────────────────────────────

function NamespacesTab() {
  const { data, loading, error, refresh } = useCostNamespaces();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 text-violet-400 animate-spin mr-2" />
        <span className="text-sm text-slate-400">Loading namespace costs…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm p-4">
        <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
      </div>
    );
  }

  const nsCosts: NamespaceCost[] = data?.namespaces ?? [];
  const maxMonth = nsCosts.length > 0 ? Math.max(...nsCosts.map(n => n.cost_per_month)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{nsCosts.length} namespaces</p>
        <button onClick={refresh} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {nsCosts.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">No namespace cost data yet.</p>
      ) : (
        <div className="space-y-2">
          {nsCosts.map((ns, idx) => (
            <motion.div
              key={ns.namespace}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
              className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  <span className="text-sm font-medium text-white truncate">{ns.namespace}</span>
                </div>
                <span className="text-sm font-semibold text-white shrink-0 ml-2">
                  {fmtK$(ns.cost_per_month)}/mo
                </span>
              </div>
              {/* Usage bar */}
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-1.5">
                <motion.div
                  className="h-full bg-violet-500 rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${(ns.cost_per_month / maxMonth) * 100}%` }}
                  transition={{ duration: 0.6, delay: idx * 0.03, ease: 'easeOut' }}
                />
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>{fmt$(ns.cost_per_hour, 4)}/hr</span>
                <span>{fmt$(ns.cost_per_day, 2)}/day</span>
                <span className="ml-auto">{ns.pod_count} pods · {ns.node_count} nodes</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Efficiency Tab ───────────────────────────────────────────────────────────

function EfficiencyTab() {
  const { data, loading, error, refresh } = useCostEfficiency();
  const { data: recsData } = useCostRecommendations();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 text-violet-400 animate-spin mr-2" />
        <span className="text-sm text-slate-400">Analyzing efficiency…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm p-4">
        <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
      </div>
    );
  }

  const scores: EfficiencyScore[] = data?.efficiencies ?? [];
  const dist = data?.grade_distribution ?? { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const totalWaste = data?.total_monthly_waste ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-2">
        {(['A', 'B', 'C', 'D', 'F'] as const).filter((g, i) => i < 3).concat(['D', 'F'] as const).slice(0, 3).map(g => (
          <div key={g} className={`rounded-lg border px-3 py-2 text-center ${gradeBg(g)}`}>
            <p className={`text-xl font-bold ${gradeColor(g)}`}>{dist[g as keyof typeof dist] ?? 0}</p>
            <p className="text-xs text-slate-400">Grade {g}</p>
          </div>
        ))}
      </div>
      {totalWaste > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-xs text-red-300">
            Est. <span className="font-semibold">{fmtK$(totalWaste)}</span> monthly waste across {scores.length} resources
          </p>
        </div>
      )}

      {/* Top recommendations */}
      {recsData && recsData.recommendations && recsData.recommendations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Top Optimizations · {fmtK$(recsData.total_savings)}/mo savings
          </p>
          {recsData.recommendations.slice(0, 5).map((opt: Optimization, idx) => (
            <motion.div
              key={`${opt.resource_id}-${idx}`}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 flex items-start justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">{opt.resource_name}</p>
                <p className="text-xs text-slate-400 truncate">{opt.description}</p>
                <p className="text-xs text-slate-500 capitalize mt-0.5">{opt.type?.replace(/_/g, ' ')}</p>
              </div>
              <span className="text-xs font-semibold text-emerald-400 shrink-0">
                {fmtK$(opt.savings)}/mo
              </span>
            </motion.div>
          ))}
        </div>
      )}

      {/* Efficiency score list */}
      {scores.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Resource Efficiency</p>
            <button onClick={refresh} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {scores.map((s, idx) => (
            <motion.div
              key={s.resource_id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
              className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 flex items-center gap-3"
            >
              <div className="relative shrink-0">
                <EfficiencyGauge value={s.overall_efficiency_pct} grade={s.grade} />
                <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${gradeColor(s.grade)}`}
                  style={{ transform: 'rotate(-135deg)' }}>
                  {s.grade}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{s.name}</p>
                <p className="text-xs text-slate-500 truncate">{s.namespace} · {s.kind}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Cpu className="h-3 w-3" /> {pct(s.cpu_efficiency_pct)}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <HardDrive className="h-3 w-3" /> {pct(s.memory_efficiency_pct)}
                  </span>
                </div>
              </div>
              {s.estimated_monthly_waste_usd > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-xs text-red-400 font-medium">{fmtK$(s.estimated_monthly_waste_usd)}</p>
                  <p className="text-xs text-slate-500">waste/mo</p>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {scores.length === 0 && !loading && (
        <p className="text-sm text-slate-500 text-center py-8">No efficiency data yet. Trigger a cost scrape from Overview.</p>
      )}
    </div>
  );
}

// ─── Grade distribution donut (simple bar version) ────────────────────────────

function GradeBar({ dist }: { dist: Record<string, number> }) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const order = ['A', 'B', 'C', 'D', 'F'];
  const colors = ['bg-emerald-500', 'bg-green-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500'];
  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-px">
      {order.map((g, i) => {
        const v = (dist[g] ?? 0) / total * 100;
        if (v === 0) return null;
        return (
          <motion.div
            key={g}
            className={`${colors[i]} h-full`}
            initial={{ width: '0%' }}
            animate={{ width: `${v}%` }}
            transition={{ duration: 0.6, delay: i * 0.06, ease: 'easeOut' }}
            title={`Grade ${g}: ${dist[g]}`}
          />
        );
      })}
    </div>
  );
}

// ─── Forecast Tab ─────────────────────────────────────────────────────────────

function ForecastTab() {
  const { data, loading, error, refresh } = useCostForecast();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-5 w-5 text-violet-400 animate-spin mr-2" />
        <span className="text-sm text-slate-400">Computing forecast…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 text-sm p-4">
        <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
      </div>
    );
  }

  const months: ForecastMonth[] = data?.forecast_6m ?? [];
  const currentMonthly = data?.current_monthly ?? 0;
  const maxCost = months.length > 0 ? Math.max(...months.map(m => m.upper_95 ?? m.cost)) : 1;

  // Month names relative to today
  const now = new Date();
  const monthNames = months.map((_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + i + 1);
    return d.toLocaleString('default', { month: 'short' });
  });

  const lastForecast = months[months.length - 1];
  const growthToEnd = lastForecast
    ? currentMonthly > 0 ? ((lastForecast.cost - currentMonthly) / currentMonthly * 100) : 0
    : 0;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="Current Monthly"
          value={fmtK$(currentMonthly)}
          icon={DollarSign}
          iconClass="text-violet-400"
        />
        {lastForecast && (
          <MetricCard
            label="6-Month Forecast"
            value={fmtK$(lastForecast.cost)}
            sub={`${growthToEnd > 0 ? '+' : ''}${growthToEnd.toFixed(1)}% growth`}
            icon={growthToEnd > 0 ? TrendingUp : growthToEnd < 0 ? TrendingDown : Minus}
            iconClass={growthToEnd > 5 ? 'text-red-400' : growthToEnd < -5 ? 'text-emerald-400' : 'text-yellow-400'}
          />
        )}
      </div>

      {/* Forecast bars */}
      {months.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">6-Month Projection</p>
            <button onClick={refresh} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300">
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
          {months.map((m, i) => (
            <div key={m.month} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 w-7">{monthNames[i]}</span>
                  {trendIcon(m.trend)}
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="text-slate-500 text-xs">{fmtK$(m.lower_95 ?? 0)}–{fmtK$(m.upper_95 ?? 0)}</span>
                  <span className="font-medium">{fmtK$(m.cost)}</span>
                </div>
              </div>
              {/* CI band + estimate bar */}
              <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden">
                {/* CI range */}
                <motion.div
                  className="absolute h-full bg-violet-500/20 rounded-full"
                  initial={{ left: '0%', right: '0%' }}
                  animate={{
                    left: `${((m.lower_95 ?? 0) / maxCost) * 100}%`,
                    width: `${((m.upper_95 ?? m.cost) - (m.lower_95 ?? 0)) / maxCost * 100}%`,
                  }}
                  transition={{ duration: 0.6, delay: i * 0.06, ease: 'easeOut' }}
                />
                {/* Point estimate */}
                <motion.div
                  className="absolute h-full bg-violet-500 rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${(m.cost / maxCost) * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.06, ease: 'easeOut' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Growth pct table */}
      {months.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Monthly Growth</p>
          <div className="grid grid-cols-6 gap-1">
            {months.map((m, i) => (
              <div key={m.month} className="text-center">
                <p className="text-xs text-slate-500">{monthNames[i]}</p>
                <p className={`text-xs font-semibold ${
                  (m.growth_pct ?? 0) > 0 ? 'text-red-400' :
                  (m.growth_pct ?? 0) < 0 ? 'text-emerald-400' : 'text-slate-400'
                }`}>
                  {(m.growth_pct ?? 0) > 0 ? '+' : ''}{(m.growth_pct ?? 0).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CostPanel ────────────────────────────────────────────────────────────────

export function CostPanel() {
  const [activeTab, setActiveTab] = useState<CostTab>('overview');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-3 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">Cost Intelligence</span>
        </div>
        <span className="text-xs text-slate-500">A-CORE-011</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                active
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
              }`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto pr-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === 'overview'   && <OverviewTab />}
            {activeTab === 'namespaces' && <NamespacesTab />}
            {activeTab === 'efficiency' && <EfficiencyTab />}
            {activeTab === 'forecast'   && <ForecastTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
