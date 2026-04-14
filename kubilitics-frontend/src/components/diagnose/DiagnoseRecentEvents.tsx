import type { WarningEvent } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

/**
 * Renders warning events with full message text as the primary line.
 * This is intentionally prominent — the message is what the user needs
 * to read to diagnose the problem, not the badges and timestamps.
 */
export interface DiagnoseRecentEventsProps {
  events: WarningEvent[];
  className?: string;
}

function humanAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function DiagnoseRecentEvents({ events, className }: DiagnoseRecentEventsProps) {
  if (events.length === 0) {
    return null;
  }

  // Sort newest first (by lastSeen)
  const sorted = [...events].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 5);
  const now = Date.now();

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden', className)}>
      <div className="px-4 py-2 bg-muted/30 border-b border-border">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent warnings (last {sorted.length})
        </h5>
      </div>
      <div className="divide-y divide-border">
        {sorted.map((e, i) => (
          <div key={i} className="px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden />
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium text-foreground leading-snug"
                title={e.message}
              >
                {e.message}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>{e.reason}</span>
                <span>·</span>
                <span>{humanAge(now - e.lastSeen)}</span>
                {e.count > 1 && (
                  <>
                    <span>·</span>
                    <span className="tabular-nums">x{e.count}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
