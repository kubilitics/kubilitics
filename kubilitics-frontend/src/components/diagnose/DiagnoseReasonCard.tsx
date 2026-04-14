import type { ReasonCode, DiagnoseAction } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';
import { DiagnoseSuggestionButton } from './DiagnoseSuggestionButton';

/**
 * Renders one ReasonCode: title + plain-English explanation + its ordered
 * list of suggestions. Used by DiagnosePanel to render each reason in a
 * broken diagnosis.
 */
export interface DiagnoseReasonCardProps {
  reason: ReasonCode;
  onSuggestionAction?: (action: DiagnoseAction) => void;
  substitutions?: { namespace?: string; pod?: string };
  className?: string;
}

export function DiagnoseReasonCard({
  reason,
  onSuggestionAction,
  substitutions,
  className,
}: DiagnoseReasonCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card/50 overflow-hidden',
        className,
      )}
    >
      <div className="px-4 py-3 border-b border-border bg-muted/20">
        <h5 className="text-sm font-semibold text-foreground">{reason.title}</h5>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{reason.explanation}</p>
      </div>
      <div className="py-1">
        {reason.suggestions.map((s, i) => (
          <DiagnoseSuggestionButton
            key={i}
            suggestion={s}
            onAction={onSuggestionAction}
            substitutions={substitutions}
          />
        ))}
      </div>
    </div>
  );
}
