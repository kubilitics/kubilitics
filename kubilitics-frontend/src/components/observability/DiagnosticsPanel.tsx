/**
 * DiagnosticsPanel — renders the check ladder + likely causes.
 * Collapsed by default; auto-expands when any check has failed.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Copy, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { DiagnosticsResponse, DiagnosticCheck, Diagnosis } from '@/services/api/observability';

interface DiagnosticsPanelProps {
  data: DiagnosticsResponse;
  className?: string;
}

export function DiagnosticsPanel({ data, className }: DiagnosticsPanelProps) {
  const failedCount = data.checks.filter((c) => !c.passed).length;
  const total = data.checks.length;
  const hasFailures = failedCount > 0;

  // Collapsed by default; auto-expand on first render if any check failed
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (hasFailures) {
      setExpanded(true);
    }
    // Run only on mount — intentionally not re-running when hasFailures changes
    // so the user can manually collapse after reviewing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn('rounded-lg border border-border/60 bg-card overflow-hidden', className)}
    >
      {/* Collapse toggle header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3',
          'hover:bg-muted/30 transition-colors text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
        aria-expanded={expanded}
        aria-controls="diagnostics-body"
      >
        <div>
          <p className="text-sm font-medium text-foreground">Diagnostics</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasFailures
              ? `${failedCount} of ${total} check${total !== 1 ? 's' : ''} failed`
              : data.summary}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {/* Animated body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id="diagnostics-body"
            key="diag-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-t border-border/40"
          >
            <div className="divide-y divide-border/40">
              {data.checks.map((check, i) => (
                <CheckRow key={`${check.name}-${i}`} check={check} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Check row ────────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: DiagnosticCheck }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        {check.passed ? (
          <Check
            className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0"
            strokeWidth={3}
            aria-label="Passed"
          />
        ) : (
          <X
            className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0"
            strokeWidth={3}
            aria-label="Failed"
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{check.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
              {check.duration_ms}ms
            </span>
          </div>
          {check.detail && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {check.detail}
            </p>
          )}
        </div>
      </div>

      {/* Likely-cause chips */}
      {check.likely_causes && check.likely_causes.length > 0 && (
        <div className="ml-6 mt-2 space-y-2">
          {check.likely_causes.map((cause, i) => (
            <CauseCard key={`${cause.signature}-${i}`} cause={cause} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cause chip ───────────────────────────────────────────────────────────────

function CauseCard({ cause }: { cause: Diagnosis }) {
  const copyTestCommand = () => {
    if (!cause.test_command) return;
    navigator.clipboard.writeText(cause.test_command).catch(() => {
      /* clipboard may be blocked */
    });
    toast.success('Copied to clipboard');
  };

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium text-foreground">{cause.title}</p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{cause.remediation}</p>

      {cause.test_command && (
        <div className="mt-2 flex items-center gap-2">
          <pre className="flex-1 font-mono text-[10.5px] text-muted-foreground bg-card border border-border/40 rounded px-2 py-1 overflow-x-auto whitespace-nowrap tabular-nums">
            {cause.test_command}
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0"
            onClick={copyTestCommand}
            aria-label="Copy test command"
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
