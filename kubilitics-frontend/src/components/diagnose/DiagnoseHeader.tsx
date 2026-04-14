import { AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import type { Diagnosis, DiagnosisSeverity } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';

/**
 * Header block for the Diagnose panel when severity is degraded, broken,
 * or unknown. Shows a severity icon, headline, and one-line summary.
 */
export interface DiagnoseHeaderProps {
  diagnosis: Diagnosis;
  className?: string;
}

const ICONS = {
  degraded: AlertTriangle,
  broken: XCircle,
  unknown: HelpCircle,
  healthy: HelpCircle, // not expected here; fallback
} as const;

const ICON_COLORS: Record<DiagnosisSeverity, string> = {
  healthy: 'text-emerald-600',
  degraded: 'text-amber-600',
  broken: 'text-rose-600',
  unknown: 'text-slate-500',
};

const SEVERITY_LABELS: Record<DiagnosisSeverity, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  broken: 'BROKEN',
  unknown: 'Unknown',
};

export function DiagnoseHeader({ diagnosis, className }: DiagnoseHeaderProps) {
  const Icon = ICONS[diagnosis.severity] ?? HelpCircle;
  const label = SEVERITY_LABELS[diagnosis.severity];
  return (
    <div
      className={cn('flex items-start gap-3', className)}
      role="status"
      aria-live="polite"
      aria-label={`Diagnose: ${diagnosis.severity}`}
    >
      <Icon
        className={cn('h-6 w-6 flex-shrink-0 mt-0.5', ICON_COLORS[diagnosis.severity])}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-xs font-semibold uppercase tracking-wider', ICON_COLORS[diagnosis.severity])}>
            {label}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-base font-semibold text-foreground">{diagnosis.headline}</span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{diagnosis.oneLine}</p>
      </div>
    </div>
  );
}
