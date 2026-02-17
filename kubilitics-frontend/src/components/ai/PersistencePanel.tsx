// A-CORE-013: Persistence Panel — 4 sub-tabs: Health, Audit Log, Anomaly History, Cost History.
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  DollarSign,
  Shield,
  RefreshCw,
  Filter,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  usePersistenceHealth,
  useAuditLog,
  useAnomalyHistory,
  useAnomalySummary,
  useCostTrend,
  useCostSnapshots,
  useLatestCostSnapshot,
} from '@/hooks/usePersistence';

// ─── Types ────────────────────────────────────────────────────────────────────

type PersistenceTab = 'health' | 'audit' | 'anomalies' | 'cost';

// ─── Severity colours ─────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-400 bg-red-500/15 border-red-500/30',
  HIGH:     'text-orange-400 bg-orange-500/15 border-orange-500/30',
  MEDIUM:   'text-yellow-400 bg-yellow-500/15 border-yellow-500/30',
  LOW:      'text-green-400 bg-green-500/15 border-green-500/30',
  INFO:     'text-blue-400 bg-blue-500/15 border-blue-500/30',
};

function SevBadge({ severity }: { severity: string }) {
  const cls = SEV_COLOR[severity?.toUpperCase()] ?? SEV_COLOR.LOW;
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border', cls)}>
      {severity}
    </span>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-foreground' }: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 space-y-0.5">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn('text-lg font-bold leading-none', color)}>{value}</div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── HealthTab ────────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, loading, error, refresh } = usePersistenceHealth();

  const isOk = data?.status === 'ok';
  const isErr = data?.status === 'error' || data?.status === 'unavailable' || !!error;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Persistence Health</h3>
          <p className="text-[10px] text-muted-foreground">SQLite store status and connectivity</p>
        </div>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Status card */}
      <div className={cn(
        'flex items-start gap-3 p-4 rounded-xl border',
        isOk ? 'bg-green-500/8 border-green-500/25'
             : isErr ? 'bg-red-500/8 border-red-500/25'
             : 'bg-muted/20 border-border/40'
      )}>
        <div className={cn(
          'shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
          isOk ? 'bg-green-500/15' : isErr ? 'bg-red-500/15' : 'bg-muted/30'
        )}>
          {isOk
            ? <CheckCircle className="h-5 w-5 text-green-400" />
            : isErr
            ? <AlertCircle className="h-5 w-5 text-red-400" />
            : <Database className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn('text-sm font-semibold',
            isOk ? 'text-green-400' : isErr ? 'text-red-400' : 'text-foreground')}>
            {loading ? 'Checking…'
              : data?.status === 'ok' ? 'Store Online'
              : data?.status === 'unavailable' ? 'Store Unavailable'
              : 'Store Error'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {data?.backend ? `Backend: ${data.backend}` : ''}
            {data?.note && ` — ${data.note}`}
            {(data?.error || error) && ` — ${data?.error ?? error}`}
          </div>
        </div>
      </div>

      {/* Feature tiles */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: Shield, label: 'Audit Log', desc: 'All AI actions recorded', color: 'text-blue-400' },
          { icon: Activity, label: 'Anomaly History', desc: 'Analytics time series', color: 'text-purple-400' },
          { icon: DollarSign, label: 'Cost Snapshots', desc: 'Daily cost trending', color: 'text-green-400' },
          { icon: Clock, label: 'Conversations', desc: 'Multi-turn chat history', color: 'text-orange-400' },
        ].map(({ icon: Icon, label, desc, color }) => (
          <div key={label} className="flex items-start gap-2 p-2.5 rounded-lg border border-border/40 bg-muted/10">
            <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', color)} />
            <div>
              <div className="text-[10px] font-semibold">{label}</div>
              <div className="text-[9px] text-muted-foreground">{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AuditTab ────────────────────────────────────────────────────────────────

function AuditTab() {
  const [filterResource, setFilterResource] = useState('');
  const [filterAction, setFilterAction] = useState('');

  const { events, total, loading, error, refresh } = useAuditLog({
    resource: filterResource || undefined,
    action: filterAction || undefined,
    limit: 100,
  });

  const resultColorMap: Record<string, string> = {
    approved: 'text-green-400',
    denied:   'text-red-400',
    pending:  'text-yellow-400',
    executed: 'text-blue-400',
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Audit Log</h3>
          <p className="text-[10px] text-muted-foreground">{total} events recorded</p>
        </div>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={filterResource}
            onChange={e => setFilterResource(e.target.value)}
            placeholder="Filter by resource…"
            className="w-full pl-6 pr-2 py-1 text-[10px] bg-muted/30 border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="relative flex-1">
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            placeholder="Filter by action…"
            className="w-full pl-6 pr-2 py-1 text-[10px] bg-muted/30 border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Events list */}
      {error && (
        <div className="p-2 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {events.length === 0 && !loading && (
        <div className="py-8 text-center">
          <Shield className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
          <div className="text-[10px] text-muted-foreground">No audit events recorded yet.</div>
          <div className="text-[9px] text-muted-foreground/60 mt-1">Events are logged as the AI takes actions.</div>
        </div>
      )}

      <div className="space-y-1">
        {events.map(ev => (
          <div key={ev.id} className="flex items-start gap-2 p-2 rounded-lg border border-border/30 bg-muted/10">
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold truncate">{ev.event_type}</span>
                {ev.resource && (
                  <span className="px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[9px] font-mono truncate">
                    {ev.resource}
                  </span>
                )}
                {ev.action && (
                  <span className="px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[9px]">
                    {ev.action}
                  </span>
                )}
                {ev.result && (
                  <span className={cn('text-[9px] font-semibold ml-auto',
                    resultColorMap[ev.result?.toLowerCase()] ?? 'text-muted-foreground')}>
                    {ev.result}
                  </span>
                )}
              </div>
              {ev.description && (
                <div className="text-[9px] text-muted-foreground truncate">{ev.description}</div>
              )}
              <div className="text-[8px] text-muted-foreground/60">
                {new Date(ev.timestamp).toLocaleString()}
                {ev.user_id && ` · ${ev.user_id}`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AnomaliesTab ────────────────────────────────────────────────────────────

function AnomaliesTab() {
  const [filterNs, setFilterNs] = useState('');
  const [filterSev, setFilterSev] = useState('');

  const { anomalies, total, loading, error, refresh } = useAnomalyHistory(
    { namespace: filterNs || undefined, severity: filterSev || undefined, limit: 100 },
    { pollIntervalMs: 60_000 }
  );

  const { data: summary } = useAnomalySummary({ pollIntervalMs: 60_000 });

  const SEVS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const sevCount = (s: string) => summary?.summary?.[s] ?? 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Anomaly History</h3>
          <p className="text-[10px] text-muted-foreground">{total} events · last 7 days</p>
        </div>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Severity summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-1.5">
          {SEVS.map(sev => (
            <button
              key={sev}
              onClick={() => setFilterSev(filterSev === sev ? '' : sev)}
              className={cn(
                'rounded-lg border p-2 text-center transition-all',
                filterSev === sev ? SEV_COLOR[sev] : 'border-border/40 bg-muted/10 hover:bg-muted/20'
              )}
            >
              <div className="text-sm font-bold">{sevCount(sev)}</div>
              <div className="text-[9px] uppercase">{sev}</div>
            </button>
          ))}
        </div>
      )}

      {/* Namespace filter */}
      <div className="relative">
        <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <input
          type="text"
          value={filterNs}
          onChange={e => setFilterNs(e.target.value)}
          placeholder="Filter by namespace…"
          className="w-full pl-6 pr-2 py-1 text-[10px] bg-muted/30 border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {error && (
        <div className="p-2 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-400">{error}</div>
      )}

      {anomalies.length === 0 && !loading && (
        <div className="py-8 text-center">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
          <div className="text-[10px] text-muted-foreground">No anomalies detected yet.</div>
          <div className="text-[9px] text-muted-foreground/60 mt-1">Anomalies will appear here as the analytics pipeline runs.</div>
        </div>
      )}

      <div className="space-y-1">
        {anomalies.map(a => (
          <div key={a.id} className="flex items-start gap-2 p-2 rounded-lg border border-border/30 bg-muted/10">
            <SevBadge severity={a.severity} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold truncate">{a.anomaly_type}</span>
                <span className="px-1 py-0.5 rounded bg-muted/30 text-muted-foreground text-[9px] font-mono">
                  {a.kind}
                </span>
                <span className="text-[9px] font-mono text-purple-400 truncate">{a.resource_id}</span>
              </div>
              {a.description && (
                <div className="text-[9px] text-muted-foreground truncate">{a.description}</div>
              )}
              <div className="flex items-center gap-2 text-[8px] text-muted-foreground/60">
                <span>{a.namespace}</span>
                <span>·</span>
                <span>score: {a.score.toFixed(2)}</span>
                <span>·</span>
                <span>{new Date(a.detected_at).toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CostHistoryTab ───────────────────────────────────────────────────────────

function CostHistoryTab() {
  const { trend, loading, error, refresh } = useCostTrend({ pollIntervalMs: 120_000 });
  const { snapshot: latest } = useLatestCostSnapshot();
  const { snapshots } = useCostSnapshots({ limit: 30 });

  // Simple bar chart using SVG
  const barData = useMemo(() => {
    if (!trend.length) return [];
    const maxCost = Math.max(...trend.map(p => p.total_cost), 1);
    return trend.slice(-20).map(p => ({
      ...p,
      barH: Math.round((p.total_cost / maxCost) * 60),
      wasteH: Math.round((p.waste_cost / maxCost) * 60),
      label: new Date(p.recorded_at).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    }));
  }, [trend]);

  const gradeColor = (g: string) => {
    const map: Record<string, string> = { A: 'text-green-400', B: 'text-blue-400', C: 'text-yellow-400', D: 'text-orange-400', F: 'text-red-400' };
    return map[g] ?? 'text-muted-foreground';
  };

  // Cost trend direction
  const trendDir = useMemo(() => {
    if (trend.length < 2) return null;
    const last = trend[trend.length - 1].total_cost;
    const prev = trend[trend.length - 2].total_cost;
    return last > prev ? 'up' : 'down';
  }, [trend]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Cost History</h3>
          <p className="text-[10px] text-muted-foreground">{trend.length} data points</p>
        </div>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-muted/40 text-muted-foreground">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Latest snapshot stats */}
      {latest && (
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="Total Cost/mo"
            value={`$${latest.total_cost.toFixed(0)}`}
            sub={trendDir === 'up' ? '↑ vs prev' : trendDir === 'down' ? '↓ vs prev' : undefined}
            color={trendDir === 'up' ? 'text-orange-400' : trendDir === 'down' ? 'text-green-400' : undefined}
          />
          <StatCard
            label="Waste/mo"
            value={`$${latest.waste_cost.toFixed(0)}`}
            sub={`${((latest.waste_cost / (latest.total_cost || 1)) * 100).toFixed(0)}% of total`}
            color="text-red-400"
          />
          <StatCard
            label="Efficiency"
            value={`${latest.efficiency.toFixed(0)}%`}
            sub={`Grade: ${latest.grade}`}
            color={gradeColor(latest.grade)}
          />
        </div>
      )}

      {error && (
        <div className="p-2 rounded bg-red-500/10 border border-red-500/25 text-[10px] text-red-400">{error}</div>
      )}

      {/* Bar chart */}
      {barData.length > 0 ? (
        <div className="rounded-xl border border-border/40 bg-muted/10 p-3">
          <div className="text-[9px] font-semibold text-muted-foreground uppercase mb-2">
            Daily Cost Trend
          </div>
          <div className="flex items-end gap-0.5 h-16 overflow-hidden">
            {barData.map((p, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative">
                {/* Total cost bar */}
                <div
                  className="w-full bg-blue-500/40 rounded-t transition-all"
                  style={{ height: `${p.barH}px` }}
                />
                {/* Waste overlay */}
                <div
                  className="w-full bg-red-500/50 rounded-t absolute bottom-0"
                  style={{ height: `${p.wasteH}px` }}
                />
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none bg-popover border border-border rounded px-2 py-1 text-[9px] whitespace-nowrap shadow">
                  <div className="font-semibold">{p.label}</div>
                  <div>Total: ${p.total_cost.toFixed(0)}</div>
                  <div className="text-red-400">Waste: ${p.waste_cost.toFixed(0)}</div>
                  <div>Grade: {p.grade}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[8px] text-muted-foreground">
            <span>{barData[0]?.label}</span>
            <span>{barData[barData.length - 1]?.label}</span>
          </div>
          <div className="flex gap-3 mt-2 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-blue-500/40" /> Total Cost</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-red-500/50" /> Waste</span>
          </div>
        </div>
      ) : (
        !loading && (
          <div className="py-8 text-center">
            <DollarSign className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
            <div className="text-[10px] text-muted-foreground">No cost history yet.</div>
            <div className="text-[9px] text-muted-foreground/60 mt-1">Snapshots are recorded as the cost pipeline runs.</div>
          </div>
        )
      )}

      {/* Recent snapshots table */}
      {snapshots.length > 0 && (
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            Recent Snapshots
          </div>
          {snapshots.slice(0, 8).map((s, i) => (
            <div key={s.id} className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-[10px]',
              i > 0 && 'border-t border-border/20'
            )}>
              <span className="text-muted-foreground text-[9px] w-20 shrink-0">
                {new Date(s.recorded_at).toLocaleDateString()}
              </span>
              <span className="font-semibold text-blue-400">${s.total_cost.toFixed(0)}</span>
              <span className="text-red-400 text-[9px]">-${s.waste_cost.toFixed(0)} waste</span>
              <span className={cn('ml-auto font-bold text-[11px]', gradeColor(s.grade))}>{s.grade}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PersistencePanel ────────────────────────────────────────────────────────

export function PersistencePanel() {
  const [activeTab, setActiveTab] = useState<PersistenceTab>('health');
  const { data: health } = usePersistenceHealth();

  const tabs: { id: PersistenceTab; label: string; icon: React.ElementType }[] = [
    { id: 'health',    label: 'Health',    icon: Database },
    { id: 'audit',     label: 'Audit',     icon: Shield },
    { id: 'anomalies', label: 'Anomalies', icon: Activity },
    { id: 'cost',      label: 'Cost Hist', icon: DollarSign },
  ];

  return (
    <div className="space-y-3">
      {/* Title bar */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-emerald-500/10">
          <Database className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Persistence Layer</h2>
          <p className="text-[9px] text-muted-foreground">
            {health?.status === 'ok' ? '● SQLite connected' : '○ Store offline'}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 bg-muted/40 rounded-lg p-0.5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all',
              activeTab === id
                ? 'bg-background text-emerald-400 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'health'    && <HealthTab />}
          {activeTab === 'audit'     && <AuditTab />}
          {activeTab === 'anomalies' && <AnomaliesTab />}
          {activeTab === 'cost'      && <CostHistoryTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
