/**
 * PreApplyPanel — "What-If" analysis panel for pre-apply blast radius prediction.
 *
 * Upload or paste a YAML manifest to see the predicted impact on the cluster
 * before applying. Shows health score delta, affected resources, new SPOFs,
 * warnings, and remediations.
 */
import { useState, useCallback, useRef } from 'react';
import {
  Upload,
  FileText,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Zap,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePreApplyBlastRadius } from '@/hooks/usePreApplyBlastRadius';
import type {
  PreviewResult,
  PreviewAffectedResource,
  PreviewRemediation,
  PreviewResourceRef,
} from '@/services/api/preview';

// --- Impact badge colors ---
const IMPACT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  created: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    label: 'Created',
  },
  modified: {
    bg: 'bg-amber-100 dark:bg-amber-900/40',
    text: 'text-amber-700 dark:text-amber-300',
    label: 'Modified',
  },
  deleted: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-700 dark:text-red-300',
    label: 'Deleted',
  },
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-orange-600 dark:text-orange-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-blue-600 dark:text-blue-400',
};

const LEVEL_GRADIENT: Record<string, string> = {
  critical: 'from-red-600 to-red-900 dark:from-red-700 dark:to-red-950',
  high: 'from-orange-500 to-orange-800 dark:from-orange-600 dark:to-orange-900',
  medium: 'from-yellow-500 to-yellow-700 dark:from-yellow-600 dark:to-yellow-800',
  low: 'from-blue-500 to-blue-700 dark:from-blue-600 dark:to-blue-800',
};

export function PreApplyPanel() {
  const [manifest, setManifest] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showRemediations, setShowRemediations] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { analyze, data, isLoading, error, reset } = usePreApplyBlastRadius();

  const handleAnalyze = useCallback(() => {
    if (manifest.trim()) {
      analyze(manifest.trim());
    }
  }, [manifest, analyze]);

  const handleClear = useCallback(() => {
    setManifest('');
    setFileName(null);
    reset();
  }, [reset]);

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setManifest(text);
      setFileName(file.name);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileRead(file);
    },
    [handleFileRead],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileRead(file);
    },
    [handleFileRead],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          What-If Analysis
        </h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Preview blast radius before applying changes
        </span>
      </div>

      {/* YAML Input Area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'relative rounded-lg border-2 border-dashed transition-colors',
          isDragOver
            ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/20'
            : 'border-slate-300 dark:border-slate-700',
        )}
      >
        {fileName && (
          <div className="flex items-center gap-2 px-3 pt-3">
            <FileText className="h-4 w-4 text-slate-500" />
            <span className="text-sm text-slate-600 dark:text-slate-400">{fileName}</span>
            <button
              onClick={() => {
                setFileName(null);
                setManifest('');
              }}
              className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <textarea
          value={manifest}
          onChange={(e) => {
            setManifest(e.target.value);
            setFileName(null);
          }}
          placeholder="Paste your Kubernetes YAML manifest here, or drag & drop a .yaml file..."
          className={cn(
            'w-full min-h-[200px] max-h-[400px] resize-y rounded-lg bg-transparent px-4 py-3',
            'font-mono text-sm text-slate-800 dark:text-slate-200',
            'placeholder:text-slate-400 dark:placeholder:text-slate-500',
            'focus:outline-none',
          )}
          spellCheck={false}
        />
        {!manifest && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-50">
            <Upload className="h-8 w-8 text-slate-400 mb-2" />
            <span className="text-sm text-slate-400">Drop YAML file here</span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleAnalyze}
          disabled={!manifest.trim() || isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Analyze Impact
            </>
          )}
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4 mr-1.5" />
          Upload File
        </Button>
        {(manifest || data) && (
          <Button variant="ghost" onClick={handleClear} className="text-slate-500">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Analysis Failed</p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {data && <PreviewResults result={data} showRemediations={showRemediations} onToggleRemediations={() => setShowRemediations((v) => !v)} />}
    </div>
  );
}

// --- Results Sub-Components ---

function PreviewResults({
  result,
  showRemediations,
  onToggleRemediations,
}: {
  result: PreviewResult;
  showRemediations: boolean;
  onToggleRemediations: () => void;
}) {
  const gradient = LEVEL_GRADIENT[result.blast_radius_level] ?? LEVEL_GRADIENT.low;

  return (
    <div className="space-y-4">
      {/* Score Banner */}
      <div
        className={cn(
          'w-full rounded-xl bg-gradient-to-r px-6 py-5 text-white shadow-lg',
          gradient,
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white/80 mb-1">Pre-Apply Impact Preview</p>
            <p className="text-lg font-semibold leading-snug tracking-tight">
              {result.total_affected} resource{result.total_affected !== 1 ? 's' : ''} affected by
              this change
            </p>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <span className="text-4xl font-extrabold tabular-nums leading-none">
              {Math.round(result.blast_radius_score)}
            </span>
            <span className="mt-1 text-xs font-medium uppercase tracking-widest text-white/80">
              {result.blast_radius_level}
            </span>
          </div>
        </div>
      </div>

      {/* Health Score Delta */}
      <HealthScoreDelta
        before={result.health_score_before}
        after={result.health_score_after}
        delta={result.health_score_delta}
      />

      {/* New SPOFs Warning */}
      {result.new_spofs.length > 0 && <SPOFWarning spofs={result.new_spofs} type="new" />}
      {result.removed_spofs.length > 0 && <SPOFWarning spofs={result.removed_spofs} type="removed" />}

      {/* Warnings */}
      {result.warnings.length > 0 && <WarningsList warnings={result.warnings} />}

      {/* Affected Resources */}
      <AffectedResourcesList resources={result.affected_resources} />

      {/* Remediations */}
      {result.remediations.length > 0 && (
        <RemediationsList
          remediations={result.remediations}
          expanded={showRemediations}
          onToggle={onToggleRemediations}
        />
      )}
    </div>
  );
}

function HealthScoreDelta({
  before,
  after,
  delta,
}: {
  before: number;
  after: number;
  delta: number;
}) {
  const isImproved = delta > 0.5;
  const isDegraded = delta < -0.5;

  let DeltaIcon = Minus;
  let deltaColor = 'text-slate-500 dark:text-slate-400';
  let deltaLabel = 'No change';

  if (isImproved) {
    DeltaIcon = TrendingUp;
    deltaColor = 'text-emerald-600 dark:text-emerald-400';
    deltaLabel = `+${delta.toFixed(1)}`;
  } else if (isDegraded) {
    DeltaIcon = TrendingDown;
    deltaColor = 'text-red-600 dark:text-red-400';
    deltaLabel = delta.toFixed(1);
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
        Cluster Health Score
      </p>
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {Math.round(before)}
        </span>
        <span className="text-slate-400 dark:text-slate-500 text-lg">&rarr;</span>
        <span
          className={cn(
            'text-2xl font-bold tabular-nums',
            isDegraded ? 'text-red-600 dark:text-red-400' : isImproved ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100',
          )}
        >
          {Math.round(after)}
        </span>
        <div className={cn('flex items-center gap-1 ml-2', deltaColor)}>
          <DeltaIcon className="h-4 w-4" />
          <span className="text-sm font-semibold">{deltaLabel}</span>
        </div>
      </div>
    </div>
  );
}

function SPOFWarning({
  spofs,
  type,
}: {
  spofs: PreviewResourceRef[];
  type: 'new' | 'removed';
}) {
  const isNew = type === 'new';

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        isNew
          ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
          : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30',
      )}
    >
      <div className="flex items-start gap-2">
        {isNew ? (
          <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
        ) : (
          <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
        )}
        <div>
          <p
            className={cn(
              'text-sm font-medium',
              isNew ? 'text-red-800 dark:text-red-200' : 'text-emerald-800 dark:text-emerald-200',
            )}
          >
            {isNew ? 'New Single Points of Failure' : 'Resolved Single Points of Failure'}
          </p>
          <ul className="mt-1.5 space-y-1">
            {spofs.map((spof) => (
              <li
                key={`${spof.kind}/${spof.namespace}/${spof.name}`}
                className={cn(
                  'text-sm',
                  isNew ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {spof.kind}/{spof.name}{' '}
                <span className="text-slate-400 dark:text-slate-500">in {spof.namespace}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function WarningsList({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function AffectedResourcesList({
  resources,
}: {
  resources: PreviewAffectedResource[];
}) {
  if (resources.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Affected Resources ({resources.length})
        </p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {resources.map((res) => {
          const style = IMPACT_STYLES[res.impact] ?? IMPACT_STYLES.modified;
          return (
            <div
              key={`${res.kind}/${res.namespace}/${res.name}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <Badge
                className={cn(
                  'text-[10px] uppercase tracking-wide border-0',
                  style.bg,
                  style.text,
                )}
              >
                {style.label}
              </Badge>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {res.kind}/{res.name}
                </span>
                <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                  {res.namespace}
                </span>
              </div>
              {res.blast_score > 0 && (
                <span
                  className={cn(
                    'text-xs font-semibold tabular-nums',
                    res.blast_score >= 70
                      ? 'text-red-600 dark:text-red-400'
                      : res.blast_score >= 45
                        ? 'text-orange-600 dark:text-orange-400'
                        : res.blast_score >= 20
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-blue-600 dark:text-blue-400',
                  )}
                >
                  Score: {Math.round(res.blast_score)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RemediationsList({
  remediations,
  expanded,
  onToggle,
}: {
  remediations: PreviewRemediation[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-3 text-left"
      >
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Remediations ({remediations.length})
        </p>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
          {remediations.map((rem, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wider mt-0.5',
                  PRIORITY_STYLES[rem.priority] ?? PRIORITY_STYLES.medium,
                )}
              >
                {rem.priority}
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-300">{rem.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
