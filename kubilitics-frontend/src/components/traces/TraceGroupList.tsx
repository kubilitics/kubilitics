/**
 * TraceGroupList — Refined, scannable trace list for resource detail pages.
 *
 * Design philosophy: operational density done right.
 *   - Groups traces by operation so users see "12 add_to_cart traces" not 12 cryptic rows
 *   - Per-group metrics: count, error rate, p50/p95 latency, latency sparkline
 *   - Visual severity bar on the left edge — red for errors, amber for slow tail
 *   - Service path shown as compact arrow flow (frontend → cart → db)
 *   - Click to expand and see individual traces in a denser sub-list
 *
 * Inspired by Linear's project view, Vercel's deployment list, Honeycomb's trace browser.
 * Built to feel native to the existing Kubilitics design system.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, AlertOctagon, Zap, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TraceSummary } from '@/services/api/traces';

/* ─── Aggregation ───────────────────────────────────────────────────────── */

interface TraceGroup {
  /** Operation name, or service name if no operation, or "(unnamed)" */
  key: string;
  operation: string;
  primaryService: string;
  /** Distinct services seen across traces in this group, ordered by frequency */
  servicePath: string[];
  traces: TraceSummary[];
  totalCount: number;
  errorCount: number;
  /** Sorted ascending durations in ns — used for percentiles + sparkline */
  durations: number[];
  p50Ns: number;
  p95Ns: number;
  maxNs: number;
  newestStartNs: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function groupTraces(traces: TraceSummary[]): TraceGroup[] {
  // Group key: operation || primary service. Falls back to service[0] when root
  // span hasn't been observed yet.
  const groups = new Map<string, TraceSummary[]>();
  for (const t of traces) {
    const op = t.root_operation || '';
    const svc = t.root_service || (t.services && t.services[0]) || '?';
    const key = op ? `${svc}::${op}` : svc;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const result: TraceGroup[] = [];
  for (const [key, list] of groups) {
    const sample = list[0];
    const operation = sample.root_operation || '(unnamed root)';
    const primaryService =
      sample.root_service || (sample.services && sample.services[0]) || '?';

    // Service path: union of services across all traces in the group, ordered
    // by frequency so the most-touched services appear first.
    const serviceFreq = new Map<string, number>();
    for (const t of list) {
      for (const s of t.services ?? []) {
        serviceFreq.set(s, (serviceFreq.get(s) ?? 0) + 1);
      }
    }
    const servicePath = [...serviceFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);

    const errorCount = list.reduce((acc, t) => acc + (t.error_count > 0 ? 1 : 0), 0);
    const durations = list.map((t) => t.duration_ns).sort((a, b) => a - b);
    const newestStartNs = list.reduce((acc, t) => Math.max(acc, t.start_time), 0);

    result.push({
      key,
      operation,
      primaryService,
      servicePath,
      traces: list.slice().sort((a, b) => b.start_time - a.start_time),
      totalCount: list.length,
      errorCount,
      durations,
      p50Ns: quantile(durations, 0.5),
      p95Ns: quantile(durations, 0.95),
      maxNs: durations[durations.length - 1] ?? 0,
      newestStartNs,
    });
  }

  // Order: error groups first, then slowest p95, then most recent.
  result.sort((a, b) => {
    const aErr = a.errorCount > 0 ? 1 : 0;
    const bErr = b.errorCount > 0 ? 1 : 0;
    if (aErr !== bErr) return bErr - aErr;
    if (b.p95Ns !== a.p95Ns) return b.p95Ns - a.p95Ns;
    return b.newestStartNs - a.newestStartNs;
  });

  return result;
}

/* ─── Format helpers ────────────────────────────────────────────────────── */

function formatDuration(ns: number): string {
  if (ns < 1_000) return `${ns}ns`;
  const us = ns / 1_000;
  if (us < 1_000) return `${us.toFixed(0)}µs`;
  const ms = us / 1_000;
  if (ms < 1_000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  const s = ms / 1_000;
  return `${s.toFixed(s < 10 ? 2 : 1)}s`;
}

function formatTimeAgo(unixNs: number): string {
  const ms = Date.now() - unixNs / 1_000_000;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function shortTraceId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/* ─── Severity classification ───────────────────────────────────────────── */

type Severity = 'error' | 'slow' | 'normal';

function severityForGroup(g: TraceGroup): Severity {
  if (g.errorCount > 0) return 'error';
  // "slow" if p95 > 1 second OR p95 is 3x p50 (long tail)
  if (g.p95Ns > 1_000_000_000) return 'slow';
  if (g.p50Ns > 0 && g.p95Ns > g.p50Ns * 3) return 'slow';
  return 'normal';
}

/* ─── Latency sparkline ─────────────────────────────────────────────────── */

interface SparklineProps {
  durations: number[];
  /** Used to scale bars to a globally-consistent axis across groups */
  globalMaxNs: number;
  severity: Severity;
}

function LatencySparkline({ durations, globalMaxNs, severity }: SparklineProps) {
  const bars = useMemo(() => {
    if (durations.length === 0) return [];
    // Show up to 24 bars; if more, sample evenly. Newest are kept.
    const MAX_BARS = 24;
    if (durations.length <= MAX_BARS) return durations;
    const step = durations.length / MAX_BARS;
    const sampled: number[] = [];
    for (let i = 0; i < MAX_BARS; i++) {
      sampled.push(durations[Math.floor(i * step)]);
    }
    return sampled;
  }, [durations]);

  const max = Math.max(globalMaxNs, 1);
  const barClass =
    severity === 'error'
      ? 'bg-rose-500/70 dark:bg-rose-400/80'
      : severity === 'slow'
        ? 'bg-amber-500/70 dark:bg-amber-400/80'
        : 'bg-emerald-500/60 dark:bg-emerald-400/70';

  return (
    <div className="flex items-end gap-px h-6 w-24 shrink-0" aria-hidden>
      {bars.map((d, i) => {
        const h = Math.max(2, (d / max) * 24);
        return (
          <div
            key={i}
            className={cn('w-1 rounded-sm transition-colors', barClass)}
            style={{ height: `${h}px` }}
          />
        );
      })}
      {/* Pad to width if fewer bars than capacity */}
      {bars.length < 24 &&
        Array.from({ length: 24 - bars.length }, (_, i) => (
          <div key={`pad-${i}`} className="w-1 h-px bg-transparent" />
        ))}
    </div>
  );
}

/* ─── Service path arrow flow ───────────────────────────────────────────── */

interface ServicePathProps {
  services: string[];
  maxVisible?: number;
}

function ServicePath({ services, maxVisible = 3 }: ServicePathProps) {
  if (services.length === 0) {
    return <span className="text-[11px] text-muted-foreground/50 italic">no services</span>;
  }
  const visible = services.slice(0, maxVisible);
  const overflow = services.length - visible.length;

  return (
    <div className="flex items-center gap-1 min-w-0" title={services.join(' → ')}>
      {visible.map((s, i) => (
        <span key={`${s}-${i}`} className="flex items-center gap-1 min-w-0">
          {i > 0 && (
            <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" strokeWidth={3} />
          )}
          <span className="font-mono text-[10.5px] tracking-tight text-foreground/80 truncate max-w-[110px]">
            {s}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <>
          <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" strokeWidth={3} />
          <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
            +{overflow}
          </span>
        </>
      )}
    </div>
  );
}

/* ─── Group row ─────────────────────────────────────────────────────────── */

interface GroupRowProps {
  group: TraceGroup;
  globalMaxNs: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function GroupRow({ group, globalMaxNs, isExpanded, onToggle }: GroupRowProps) {
  const severity = severityForGroup(group);
  const errorRate = (group.errorCount / group.totalCount) * 100;

  // Severity-driven left-edge accent. This is the first thing a user's eye
  // catches when scanning the list — it has to be honest and consistent.
  const accentClass =
    severity === 'error'
      ? 'before:bg-gradient-to-b before:from-rose-500 before:to-rose-600 dark:before:from-rose-400 dark:before:to-rose-500'
      : severity === 'slow'
        ? 'before:bg-gradient-to-b before:from-amber-500 before:to-amber-600 dark:before:from-amber-400 dark:before:to-amber-500'
        : 'before:bg-gradient-to-b before:from-emerald-500/60 before:to-emerald-600/60 dark:before:from-emerald-400/50 dark:before:to-emerald-500/50';

  const rowBgClass =
    severity === 'error'
      ? 'bg-rose-50/40 dark:bg-rose-950/15 hover:bg-rose-50/70 dark:hover:bg-rose-950/25'
      : severity === 'slow'
        ? 'hover:bg-amber-50/60 dark:hover:bg-amber-950/20'
        : 'hover:bg-muted/40';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        // Layout
        'group relative w-full text-left px-4 py-3 transition-colors',
        // Severity accent bar (left edge)
        'before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-sm',
        accentClass,
        rowBgClass,
        // Open state — soft inset shadow at the bottom that the expanded list flows from
        isExpanded && 'bg-muted/30 dark:bg-muted/15',
      )}
      aria-expanded={isExpanded}
    >
      <div className="flex items-center gap-4 pl-3">
        {/* Chevron */}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150',
            isExpanded && 'rotate-90 text-foreground/80',
          )}
          strokeWidth={2.5}
        />

        {/* Operation + service path block */}
        <div className="flex-1 min-w-0">
          {/* Top line: operation name, severity icon */}
          <div className="flex items-center gap-2 min-w-0">
            {severity === 'error' && (
              <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" strokeWidth={2.5} />
            )}
            {severity === 'slow' && (
              <Zap className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2.5} />
            )}
            <span
              className={cn(
                'font-mono text-[12.5px] tracking-tight truncate',
                severity === 'error'
                  ? 'text-rose-700 dark:text-rose-300 font-medium'
                  : 'text-foreground',
              )}
            >
              {group.operation}
            </span>
          </div>
          {/* Bottom line: service path */}
          <div className="mt-1 ml-0">
            <ServicePath services={group.servicePath} />
          </div>
        </div>

        {/* Metrics block — fixed width so columns align across rows */}
        <div className="flex items-center gap-5 shrink-0">
          {/* Trace count + error rate */}
          <div className="flex flex-col items-end leading-tight w-20">
            <span className="font-mono text-[12px] text-foreground tabular-nums">
              {group.totalCount}
              <span className="text-muted-foreground/60 text-[10px] ml-0.5">
                {group.totalCount === 1 ? 'trace' : 'traces'}
              </span>
            </span>
            {group.errorCount > 0 ? (
              <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">
                {errorRate.toFixed(0)}% errors
              </span>
            ) : (
              <span className="font-mono text-[10px] text-emerald-600/70 dark:text-emerald-400/70 tabular-nums mt-0.5">
                0% errors
              </span>
            )}
          </div>

          {/* p50 / p95 — quantiles, not raw duration */}
          <div className="flex flex-col items-end leading-tight w-20">
            <span className="font-mono text-[12px] text-foreground tabular-nums">
              {formatDuration(group.p95Ns)}
              <span className="text-muted-foreground/60 text-[9px] ml-0.5">p95</span>
            </span>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums mt-0.5">
              {formatDuration(group.p50Ns)}
              <span className="text-muted-foreground/40 text-[9px] ml-0.5">p50</span>
            </span>
          </div>

          {/* Latency sparkline */}
          <LatencySparkline
            durations={group.durations}
            globalMaxNs={globalMaxNs}
            severity={severity}
          />

          {/* Time of newest */}
          <div className="flex flex-col items-end leading-tight w-12 shrink-0">
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatTimeAgo(group.newestStartNs)}
              <span className="text-muted-foreground/40 ml-0.5">ago</span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ─── Expanded individual traces ────────────────────────────────────────── */

function ExpandedTraces({ traces }: { traces: TraceSummary[] }) {
  // Cap the inline list so we don't blow up tall rows. "View all in Explorer" link below.
  const MAX_INLINE = 8;
  const visible = traces.slice(0, MAX_INLINE);
  const overflow = traces.length - visible.length;

  return (
    <div className="bg-muted/20 dark:bg-muted/10 border-y border-border/40">
      <div className="pl-12 pr-4 py-2">
        <div className="grid grid-cols-[8rem_1fr_auto_auto_auto] gap-x-4 gap-y-px text-[10.5px] text-muted-foreground/70 font-mono uppercase tracking-wider mb-1.5 px-2">
          <span>Trace ID</span>
          <span>Services</span>
          <span className="text-right">Spans</span>
          <span className="text-right">Duration</span>
          <span className="text-right">When</span>
        </div>
        <div className="rounded border border-border/40 overflow-hidden divide-y divide-border/30 bg-card">
          {visible.map((t) => {
            const isError = t.error_count > 0 || t.status === 'ERROR';
            return (
              <Link
                key={t.trace_id}
                to={`/traces?traceId=${encodeURIComponent(t.trace_id)}`}
                className={cn(
                  'grid grid-cols-[8rem_1fr_auto_auto_auto] gap-x-4 items-center px-2 py-1.5 transition-colors',
                  isError
                    ? 'bg-rose-50/30 dark:bg-rose-950/10 hover:bg-rose-50/60 dark:hover:bg-rose-950/20'
                    : 'hover:bg-muted/40',
                )}
              >
                <span className="font-mono text-[10.5px] text-foreground/70 tracking-tight tabular-nums truncate">
                  {shortTraceId(t.trace_id)}
                  {isError && (
                    <span className="ml-1.5 text-rose-600 dark:text-rose-400 text-[9px] font-semibold uppercase">
                      err
                    </span>
                  )}
                </span>
                <div className="min-w-0">
                  <ServicePath services={t.services ?? []} maxVisible={4} />
                </div>
                <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums text-right">
                  {t.span_count}
                </span>
                <span className="font-mono text-[10.5px] text-foreground tabular-nums text-right">
                  {formatDuration(t.duration_ns)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums text-right w-10">
                  {formatTimeAgo(t.start_time)}
                </span>
              </Link>
            );
          })}
        </div>
        {overflow > 0 && (
          <p className="mt-1.5 text-[10.5px] text-muted-foreground/70 px-2">
            +{overflow} more {overflow === 1 ? 'trace' : 'traces'} in this group — open the Traces Explorer for the full list.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Empty state for the (rare) case where there are zero groups ───────── */

function EmptyGroups() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Activity className="h-4 w-4 mr-2 text-muted-foreground/50" />
      <span className="text-xs">No traces in selected time range.</span>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */

interface TraceGroupListProps {
  traces: TraceSummary[];
}

export function TraceGroupList({ traces }: TraceGroupListProps) {
  const groups = useMemo(() => groupTraces(traces), [traces]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Single global max for sparkline normalization — keeps bars comparable
  // across groups so the eye instantly sees which group is slowest.
  const globalMaxNs = useMemo(
    () => groups.reduce((acc, g) => Math.max(acc, g.maxNs), 0),
    [groups],
  );

  // Topline summary: total traces, error groups, slow groups
  const summary = useMemo(() => {
    const errGroups = groups.filter((g) => g.errorCount > 0).length;
    const slowGroups = groups.filter((g) => severityForGroup(g) === 'slow').length;
    const totalTraces = groups.reduce((acc, g) => acc + g.totalCount, 0);
    const totalErrors = groups.reduce((acc, g) => acc + g.errorCount, 0);
    return { errGroups, slowGroups, totalTraces, totalErrors };
  }, [groups]);

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (groups.length === 0) return <EmptyGroups />;

  return (
    <div className="flex flex-col">
      {/* Topline summary strip */}
      <div className="flex items-center gap-5 px-4 py-2 border-b border-border/40 bg-muted/20 dark:bg-muted/10">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[14px] font-medium tabular-nums text-foreground">
            {summary.totalTraces}
          </span>
          <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
            traces
          </span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[14px] font-medium tabular-nums text-foreground">
            {groups.length}
          </span>
          <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
            operations
          </span>
        </div>
        {summary.errGroups > 0 && (
          <>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[14px] font-medium tabular-nums text-rose-600 dark:text-rose-400">
                {summary.totalErrors}
              </span>
              <span className="text-[10.5px] uppercase tracking-wider text-rose-600/70 dark:text-rose-400/70">
                errors
              </span>
              <span className="text-[10.5px] text-muted-foreground/60">
                in {summary.errGroups}{' '}
                {summary.errGroups === 1 ? 'op' : 'ops'}
              </span>
            </div>
          </>
        )}
        {summary.slowGroups > 0 && (
          <>
            <div className="h-3 w-px bg-border" />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[14px] font-medium tabular-nums text-amber-600 dark:text-amber-400">
                {summary.slowGroups}
              </span>
              <span className="text-[10.5px] uppercase tracking-wider text-amber-600/70 dark:text-amber-400/70">
                slow {summary.slowGroups === 1 ? 'op' : 'ops'}
              </span>
            </div>
          </>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground/60 font-mono">
          ranked by errors → p95 → recency
        </span>
      </div>

      {/* Group rows */}
      <div className="divide-y divide-border/30">
        {groups.map((g) => {
          const expanded = expandedKeys.has(g.key);
          return (
            <div key={g.key}>
              <GroupRow
                group={g}
                globalMaxNs={globalMaxNs}
                isExpanded={expanded}
                onToggle={() => toggle(g.key)}
              />
              {expanded && <ExpandedTraces traces={g.traces} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
