/**
 * BackendConnectionPanel — World-class Backend Connection & Event Monitor UI for A-CORE-008.
 *
 * Shows:
 *   • Connection status badge with animated pulse
 *   • World Model bootstrap status + resource kind distribution
 *   • Event stream with anomaly badges
 *   • Anomaly patterns with severity indicators
 *   • Auto-refresh with manual refresh button
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  Database,
  Layers,
  Cpu,
  Clock,
  Zap,
  Loader2,
  Eye,
  TrendingUp,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  useBackendConnection,
  type AnomalyPattern,
  type RecentEvent,
  type WorldModelStatusInfo,
} from '@/hooks/useBackendConnection';

// ─── Connection badge ──────────────────────────────────────────────────────────

function ConnectionBadge({ state, connected }: { state: string; connected: boolean }) {
  const config = useMemo(() => {
    if (connected || state === 'CONNECTED') {
      return {
        label: 'Connected',
        color: 'bg-emerald-500',
        ring: 'ring-emerald-400/30',
        text: 'text-emerald-400',
        icon: Wifi,
      };
    }
    if (state === 'RECONNECTING' || state === 'CONNECTING') {
      return {
        label: state === 'RECONNECTING' ? 'Reconnecting…' : 'Connecting…',
        color: 'bg-amber-500',
        ring: 'ring-amber-400/30',
        text: 'text-amber-400',
        icon: RefreshCw,
      };
    }
    if (state === 'N/A' || state === 'UNKNOWN') {
      return {
        label: 'Not configured',
        color: 'bg-zinc-500',
        ring: 'ring-zinc-400/30',
        text: 'text-zinc-400',
        icon: WifiOff,
      };
    }
    return {
      label: 'Disconnected',
      color: 'bg-red-500',
      ring: 'ring-red-400/30',
      text: 'text-red-400',
      icon: WifiOff,
    };
  }, [state, connected]);

  const Icon = config.icon;
  const isAnimating = state === 'RECONNECTING' || state === 'CONNECTING';

  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10', config.ring)}>
      <div className="relative flex items-center justify-center">
        <div className={cn('w-2 h-2 rounded-full', config.color)} />
        {(connected || state === 'CONNECTED') && (
          <div className={cn('absolute w-2 h-2 rounded-full animate-ping opacity-60', config.color)} />
        )}
      </div>
      <Icon
        className={cn('w-3.5 h-3.5', config.text, isAnimating && 'animate-spin')}
        style={isAnimating ? { animationDuration: '1.5s' } : undefined}
      />
      <span className={cn('text-xs font-medium', config.text)}>{config.label}</span>
    </div>
  );
}

// ─── World model card ──────────────────────────────────────────────────────────

function WorldModelCard({ wm }: { wm: WorldModelStatusInfo }) {
  const topKinds = useMemo(() => {
    if (!wm.kind_counts) return [];
    return Object.entries(wm.kind_counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [wm.kind_counts]);

  const topNamespaces = useMemo(() => {
    if (!wm.namespace_counts) return [];
    return Object.entries(wm.namespace_counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [wm.namespace_counts]);

  const maxCount = topKinds[0]?.[1] ?? 1;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-violet-500/20">
            <Database className="w-4 h-4 text-violet-400" />
          </div>
          <span className="text-sm font-semibold text-zinc-200">World Model</span>
        </div>
        <div className="flex items-center gap-2">
          {wm.bootstrapped ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Bootstrapped
            </Badge>
          ) : (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Not bootstrapped
            </Badge>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xl font-bold text-zinc-100">{wm.total_resources.toLocaleString()}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Total Resources</div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xl font-bold text-zinc-100">{Object.keys(wm.kind_counts ?? {}).length}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Resource Kinds</div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-xl font-bold text-zinc-100">{Object.keys(wm.namespace_counts ?? {}).length}</div>
          <div className="text-xs text-zinc-500 mt-0.5">Namespaces</div>
        </div>
      </div>

      {/* Kind distribution bar chart */}
      {topKinds.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Resource Distribution
          </p>
          <div className="space-y-1.5">
            {topKinds.map(([kind, count]) => (
              <div key={kind} className="flex items-center gap-2">
                <span className="w-24 text-xs text-zinc-400 truncate">{kind}</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-violet-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(3, (count / maxCount) * 100)}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-zinc-500">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top namespaces */}
      {topNamespaces.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topNamespaces.map(([ns, count]) => (
            <span
              key={ns}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-xs border border-blue-500/20"
            >
              <Cpu className="w-2.5 h-2.5" />
              {ns}
              <span className="text-blue-500/70">({count})</span>
            </span>
          ))}
        </div>
      )}

      {wm.last_sync_at && (
        <p className="text-xs text-zinc-600 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Last sync: {new Date(wm.last_sync_at).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

// ─── Anomaly pattern card ──────────────────────────────────────────────────────

const anomalyColors: Record<
  string,
  { bg: string; border: string; text: string; icon: typeof AlertTriangle }
> = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', icon: XCircle },
  warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', icon: AlertTriangle },
  normal: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', icon: Activity },
};

function AnomalyCard({ pattern }: { pattern: AnomalyPattern }) {
  const cfg = anomalyColors[pattern.severity] ?? anomalyColors.warning;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn('rounded-lg border p-3 space-y-2', cfg.bg, cfg.border)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4 shrink-0', cfg.text)} />
          <span className={cn('text-xs font-semibold', cfg.text)}>
            {pattern.type.replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>
        <Badge className={cn('text-[10px] shrink-0', cfg.bg, cfg.text, 'border', cfg.border)}>
          {pattern.event_count} events
        </Badge>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed">{pattern.description}</p>
      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1">
          <Layers className="w-2.5 h-2.5" />
          {pattern.resource}
        </span>
        {pattern.namespace && (
          <span className="flex items-center gap-1">
            <Cpu className="w-2.5 h-2.5" />
            {pattern.namespace}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: RecentEvent }) {
  const isWarning = event.type === 'warning' || event.type === 'Warning';
  const isCritical = event.type === 'critical';

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-3 py-2 rounded-lg transition-colors',
        isCritical
          ? 'bg-red-500/8 border border-red-500/20'
          : isWarning
            ? 'bg-amber-500/8 border border-amber-500/20'
            : 'border border-transparent hover:bg-white/5',
      )}
    >
      <div
        className={cn(
          'mt-0.5 w-2 h-2 rounded-full shrink-0',
          isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-zinc-600',
        )}
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'text-xs font-semibold',
              isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-zinc-300',
            )}
          >
            {event.reason}
          </span>
          {event.is_anomaly && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] py-0">
              <Zap className="w-2.5 h-2.5 mr-0.5" />
              anomaly
            </Badge>
          )}
          <span className="text-[11px] text-zinc-500 truncate">
            {event.involved_kind}/{event.involved_name}
            {event.namespace ? ` · ${event.namespace}` : ''}
          </span>
        </div>
        {event.message && (
          <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">{event.message}</p>
        )}
      </div>
      {event.count > 1 && (
        <span className="shrink-0 text-[10px] text-zinc-600 bg-white/5 px-1.5 py-0.5 rounded">
          ×{event.count}
        </span>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export interface BackendConnectionPanelProps {
  pollIntervalMs?: number;
}

export function BackendConnectionPanel({ pollIntervalMs = 10_000 }: BackendConnectionPanelProps) {
  const { status, recentEvents, loading, error, lastRefreshedAt, refresh } =
    useBackendConnection({ pollIntervalMs });

  const anomalies = status?.events?.anomaly_patterns ?? [];
  const hasAnomalies = anomalies.length > 0;

  return (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/20">
            <Server className="w-4 h-4 text-cyan-400" />
          </div>
          <span className="text-sm font-semibold text-zinc-200">Backend Connection</span>
          {hasAnomalies && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">
              {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshedAt && (
            <span className="text-[11px] text-zinc-600">
              {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-200"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Error state */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30"
              >
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-400">Cannot reach AI server</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Loading skeleton */}
          {loading && !status && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          )}

          {/* Connection card */}
          {status && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/20">
                    <Wifi className="w-4 h-4 text-cyan-400" />
                  </div>
                  <span className="text-sm font-semibold text-zinc-200">gRPC Connection</span>
                </div>
                <ConnectionBadge
                  state={status.connection.state}
                  connected={status.connection.connected}
                />
              </div>
              {status.connection.backend_address && (
                <p className="text-xs text-zinc-500 font-mono">
                  {status.connection.backend_address}
                </p>
              )}
              {status.connection.message && (
                <p className="text-xs text-zinc-500">{status.connection.message}</p>
              )}
            </motion.div>
          )}

          {/* World Model card */}
          {status?.world_model && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <WorldModelCard wm={status.world_model} />
            </motion.div>
          )}

          {/* Event stats overview */}
          {status?.events && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/20">
                  <Activity className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-sm font-semibold text-zinc-200">Event Statistics</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-white/5 p-3 text-center">
                  <div className="text-xl font-bold text-zinc-100">{status.events.total_events}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Total Events</div>
                </div>
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                  <div className="text-xl font-bold text-amber-400">{status.events.warning_events}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Warnings</div>
                </div>
                <div
                  className={cn(
                    'rounded-lg p-3 text-center border',
                    status.events.anomaly_count > 0
                      ? 'bg-red-500/10 border-red-500/20'
                      : 'bg-white/5 border-transparent',
                  )}
                >
                  <div
                    className={cn(
                      'text-xl font-bold',
                      status.events.anomaly_count > 0 ? 'text-red-400' : 'text-zinc-100',
                    )}
                  >
                    {status.events.anomaly_count}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">Anomalies</div>
                </div>
              </div>

              {/* Top reasons */}
              {status.events.top_reasons &&
                Object.keys(status.events.top_reasons).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Top Event Reasons
                    </p>
                    {Object.entries(status.events.top_reasons)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([reason, count]) => (
                        <div key={reason} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-400 truncate">{reason}</span>
                          <span className="text-zinc-500 shrink-0 ml-2">{count}</span>
                        </div>
                      ))}
                  </div>
                )}
            </motion.div>
          )}

          {/* Anomaly patterns */}
          <AnimatePresence>
            {hasAnomalies && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ delay: 0.15 }}
                className="space-y-2"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold text-red-300">Active Anomalies</span>
                </div>
                {anomalies.map((pattern, i) => (
                  <AnomalyCard key={`${pattern.type}-${i}`} pattern={pattern} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recent events */}
          {recentEvents.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-semibold text-zinc-200">Recent Events</span>
                <span className="text-xs text-zinc-500">({recentEvents.length})</span>
              </div>
              <div className="space-y-1">
                {recentEvents.map((ev, i) => (
                  <EventRow key={ev.id ?? i} event={ev} />
                ))}
              </div>
            </motion.div>
          )}

          {/* Empty state */}
          {!loading && !error && !status && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white/5 border border-white/10">
                <Server className="w-7 h-7 text-zinc-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-400">No backend data</p>
                <p className="text-xs text-zinc-600 mt-1">
                  The AI server backend status is unavailable.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                className="text-xs border-white/10"
              >
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Retry
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
