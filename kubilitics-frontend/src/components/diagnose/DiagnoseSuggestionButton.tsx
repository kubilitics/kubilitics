import { ChevronRight } from 'lucide-react';
import type { Suggestion, DiagnoseAction } from '@/lib/diagnose/types';
import { cn } from '@/lib/utils';

/**
 * Renders a single suggestion from a ReasonCode. If the suggestion has an
 * `action`, the whole row becomes a clickable button that calls onAction.
 * Otherwise it's a plain static row.
 *
 * The optional kubectlHint is rendered below the text in a monospace
 * <pre> block so operators can read and copy the exact command.
 */
export interface DiagnoseSuggestionButtonProps {
  suggestion: Suggestion;
  onAction?: (action: DiagnoseAction) => void;
  /** Placeholder substitutions for {namespace} / {pod} in kubectlHint. */
  substitutions?: { namespace?: string; pod?: string };
  className?: string;
}

export function DiagnoseSuggestionButton({
  suggestion,
  onAction,
  substitutions,
  className,
}: DiagnoseSuggestionButtonProps) {
  const hint = suggestion.kubectlHint
    ? suggestion.kubectlHint
        .replace('{namespace}', substitutions?.namespace ?? 'default')
        .replace('{pod}', substitutions?.pod ?? '')
    : undefined;

  const content = (
    <div className="flex-1 text-left">
      <div className="text-sm text-foreground leading-snug">{suggestion.text}</div>
      {hint && (
        <pre className="mt-1 text-xs font-mono text-muted-foreground bg-muted/30 rounded px-2 py-1 overflow-x-auto whitespace-pre">
          {hint}
        </pre>
      )}
    </div>
  );

  if (suggestion.action && onAction) {
    const action = suggestion.action;
    return (
      <button
        type="button"
        onClick={() => onAction(action)}
        className={cn(
          'w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left',
          'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          'transition-colors',
          className,
        )}
      >
        {content}
        <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden />
      </button>
    );
  }

  return (
    <div className={cn('flex items-start gap-3 px-3 py-2.5', className)}>
      {content}
    </div>
  );
}
