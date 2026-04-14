import type { ContainerDiagnosis } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';

/**
 * Renders a compact table of container states. Shows init containers with
 * an "init" badge. Each row: name + state/reason + restart count + ready.
 * Init containers appear first.
 */
export interface DiagnoseContainerStatesProps {
  containers: ContainerDiagnosis[];
  className?: string;
}

const STATE_COLOR: Record<ContainerDiagnosis['state'], string> = {
  running: 'text-emerald-600',
  waiting: 'text-rose-600',
  terminated: 'text-amber-600',
  unknown: 'text-slate-500',
};

export function DiagnoseContainerStates({ containers, className }: DiagnoseContainerStatesProps) {
  if (containers.length === 0) {
    return null;
  }

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden', className)}>
      <div className="px-4 py-2 bg-muted/30 border-b border-border">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Container states
        </h5>
      </div>
      <div className="divide-y divide-border">
        {containers.map((c) => (
          <div
            key={`${c.isInit ? 'init-' : ''}${c.name}`}
            className="px-4 py-2.5 flex items-center gap-3 text-sm"
          >
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {c.isInit && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-500/10 px-1.5 py-0.5 rounded">
                  init
                </span>
              )}
              <span className="font-medium text-foreground truncate">{c.name}</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className={cn('font-medium', STATE_COLOR[c.state])}>
                {c.state}
                {c.reason ? ` · ${c.reason}` : ''}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {c.restartCount} restart{c.restartCount === 1 ? '' : 's'}
              </span>
              <span
                className={cn(
                  'font-medium tabular-nums',
                  c.ready ? 'text-emerald-600' : 'text-slate-500',
                )}
              >
                {c.ready ? 'ready' : 'not ready'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
