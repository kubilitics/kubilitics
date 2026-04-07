/**
 * SystemEventMarker — distinctive inline marker for K8s system events
 * injected between log lines at the correct timestamp.
 */
import { memo } from 'react';
import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WideEvent } from '@/services/api/eventsIntelligence';

/* ─── Props ───────────────────────────────────────────────────────────────── */

export interface SystemEventMarkerProps {
  event: WideEvent;
  onNavigate: (eventId: string) => void;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function formatEventTime(ts: number): string {
  if (!ts) return '';
  try {
    const d = new Date(ts > 1e12 ? ts : ts * 1000);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-500 dark:text-red-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-500 dark:text-red-400',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
  info: 'bg-blue-500/8 border-blue-500/25 text-blue-600 dark:text-blue-400',
};

function getSeverityStyle(severity: string, eventType: string): string {
  const s = severity?.toLowerCase();
  if (s && SEVERITY_STYLES[s]) return SEVERITY_STYLES[s];
  // Fall back based on event type
  if (eventType?.toLowerCase() === 'warning') return SEVERITY_STYLES.warning;
  return SEVERITY_STYLES.info;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export const SystemEventMarker = memo(function SystemEventMarker({
  event,
  onNavigate,
}: SystemEventMarkerProps) {
  const style = getSeverityStyle(event.severity, event.event_type);
  const time = formatEventTime(event.timestamp);

  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 border-y border-dashed transition-colors cursor-pointer',
        style,
        'hover:opacity-80',
      )}
      onClick={() => onNavigate(event.event_id)}
      title="Click to view in Events Intelligence"
    >
      {/* Left dash line */}
      <span className="flex-1 border-t border-dashed border-current opacity-30 max-w-8" />

      <Zap className="h-3.5 w-3.5 shrink-0" />

      <span className="text-[11px] font-semibold uppercase tracking-wider shrink-0">
        System Event:
      </span>

      <span className="text-[11px] font-mono truncate">
        {event.resource_name} {event.reason}
      </span>

      {time && (
        <span className="text-[10px] tabular-nums opacity-60 shrink-0">({time})</span>
      )}

      {/* Right dash line */}
      <span className="flex-1 border-t border-dashed border-current opacity-30" />
    </button>
  );
});
