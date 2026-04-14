import { CheckCircle2 } from 'lucide-react';
import type { Diagnosis } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';

/**
 * Compact one-line healthy state for the Diagnose panel. Green border,
 * checkmark icon, headline on one line, one-line summary on the next.
 * Deliberately small — healthy is the common case and shouldn't dominate.
 */
export interface DiagnoseHealthyStateProps {
  diagnosis: Diagnosis;
  /** Optional trailing content (typically the Copy-as-describe button). */
  action?: React.ReactNode;
  className?: string;
}

export function DiagnoseHealthyState({ diagnosis, action, className }: DiagnoseHealthyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Diagnose: healthy"
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5',
        className,
      )}
    >
      <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground">{diagnosis.headline}</div>
        <div className="text-xs text-muted-foreground truncate">{diagnosis.oneLine}</div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
