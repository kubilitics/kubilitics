import type { Diagnosis, DiagnoseAction } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';
import { DiagnoseHealthyState } from './DiagnoseHealthyState';
import { DiagnoseHeader } from './DiagnoseHeader';
import { DiagnoseReasonCard } from './DiagnoseReasonCard';
import { DiagnoseContainerStates } from './DiagnoseContainerStates';
import { DiagnoseRecentEvents } from './DiagnoseRecentEvents';
import { CopyAsDescribeButton } from './CopyAsDescribeButton';

/**
 * Top-level Diagnose panel. Dispatches by severity:
 *  - healthy → compact green one-liner
 *  - degraded/broken/unknown → full panel with header, reason cards,
 *    container states, recent warnings, and copy button.
 *
 * No data fetching — parents supply the diagnosis via props (typically
 * computed inside a useMemo that wraps diagnoseWorkload).
 */
export interface DiagnosePanelProps {
  diagnosis: Diagnosis;
  resource: { metadata: { name: string; namespace?: string } };
  /** Called when a suggestion action wants to switch tabs or deep-link. */
  onAction?: (action: DiagnoseAction) => void;
  className?: string;
}

// Severity-driven border colors for the outer container.
const SEVERITY_BORDER: Record<Diagnosis['severity'], string> = {
  healthy: '', // healthy uses its own inner component styling
  degraded: 'border-amber-500/30 bg-amber-500/5',
  broken: 'border-rose-500/40 bg-rose-500/5',
  unknown: 'border-slate-500/30 bg-slate-500/5',
};

export function DiagnosePanel({ diagnosis, resource, onAction, className }: DiagnosePanelProps) {
  // Healthy state uses its own compact container
  if (diagnosis.severity === 'healthy') {
    return (
      <DiagnoseHealthyState
        diagnosis={diagnosis}
        action={<CopyAsDescribeButton diagnosis={diagnosis} resource={resource} />}
        className={className}
      />
    );
  }

  const subs = {
    namespace: diagnosis.namespace,
    pod: diagnosis.name,
  };

  return (
    <section
      aria-label={`Diagnose: ${diagnosis.severity}`}
      className={cn(
        'rounded-lg border p-4 space-y-4',
        SEVERITY_BORDER[diagnosis.severity],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <DiagnoseHeader diagnosis={diagnosis} />
        <CopyAsDescribeButton diagnosis={diagnosis} resource={resource} />
      </div>

      {diagnosis.reasons.length > 0 && (
        <div className="space-y-3">
          {diagnosis.reasons.map((r, i) => (
            <DiagnoseReasonCard
              key={`${r.code}-${i}`}
              reason={r}
              onSuggestionAction={onAction}
              substitutions={subs}
            />
          ))}
        </div>
      )}

      {diagnosis.containers.length > 0 && (
        <DiagnoseContainerStates containers={diagnosis.containers} />
      )}

      {diagnosis.recentWarnings.length > 0 && (
        <DiagnoseRecentEvents events={diagnosis.recentWarnings} />
      )}
    </section>
  );
}
