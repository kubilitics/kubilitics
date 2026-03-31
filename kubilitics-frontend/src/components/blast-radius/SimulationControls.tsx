/**
 * SimulationControls — Action bar for blast radius failure simulation.
 *
 * Shows "Simulate Failure" when idle, progress bar + wave counter during simulation,
 * plus utility buttons for fit-view and PNG export.
 */
import { Zap, X, Maximize2, Download } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SimulationControlsProps {
  onSimulate: () => void;
  onClear: () => void;
  onFitView: () => void;
  onExport: () => void;
  onExportCSV?: () => void;
  isSimulating: boolean;
  /** Number of resources affected so far */
  affectedCount: number;
}

const btnSecondary = cn(
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
  'border border-slate-200 dark:border-slate-700',
  'text-slate-600 dark:text-slate-300',
  'bg-white dark:bg-slate-800',
  'hover:bg-slate-50 dark:hover:bg-slate-700',
  'transition-colors',
);

export function SimulationControls({
  onSimulate,
  onClear,
  onFitView,
  onExport,
  onExportCSV,
  isSimulating,
  affectedCount,
}: SimulationControlsProps) {

  return (
    <motion.div
      className="flex items-center justify-between gap-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {!isSimulating ? (
          <button
            type="button"
            onClick={onSimulate}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold',
              'bg-red-600 text-white shadow-sm',
              'hover:bg-red-700 active:bg-red-800',
              'dark:bg-red-600 dark:hover:bg-red-700',
              'transition-colors',
            )}
          >
            <Zap className="h-4 w-4" />
            Simulate Failure
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                {affectedCount} resource{affectedCount !== 1 ? 's' : ''} affected
              </span>
            </div>
            <button
              type="button"
              onClick={onClear}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
                'border border-slate-300 dark:border-slate-600',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-50 dark:hover:bg-slate-800',
                'transition-colors',
              )}
            >
              <X className="h-3.5 w-3.5" />
              Clear Simulation
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={onFitView} className={btnSecondary} title="Fit view">
          <Maximize2 className="h-3.5 w-3.5" />
          Fit View
        </button>
        <button type="button" onClick={onExport} className={btnSecondary} title="Export PNG">
          <Download className="h-3.5 w-3.5" />
          PNG
        </button>
        {onExportCSV && (
          <button type="button" onClick={onExportCSV} className={btnSecondary} title="Export CSV with resource details">
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        )}
      </div>
    </motion.div>
  );
}
