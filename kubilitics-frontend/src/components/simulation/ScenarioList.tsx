/**
 * ScenarioList — Left panel showing scenario cards for the What-If Simulation page.
 *
 * - Each card shows type icon, description, and remove button
 * - Empty state when no scenarios are added
 * - framer-motion for card add/remove animations
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  Server,
  Globe,
  ArrowDown,
  Trash2,
  FolderX,
  FileCode,
  X,
  FlaskConical,
} from 'lucide-react';
import { useSimulationStore } from '@/stores/simulationStore';
import type { Scenario } from '@/services/api/simulation';
import type { LucideIcon } from 'lucide-react';

// ── Scenario display helpers ─────────────────────────────────────────────────

const SCENARIO_META: Record<Scenario['type'], { icon: LucideIcon; label: string; color: string }> = {
  node_failure: { icon: Server, label: 'Node Failure', color: 'text-red-500' },
  az_failure: { icon: Globe, label: 'AZ Failure', color: 'text-orange-500' },
  scale_down: { icon: ArrowDown, label: 'Scale Down', color: 'text-amber-500' },
  resource_delete: { icon: Trash2, label: 'Delete Resource', color: 'text-rose-500' },
  namespace_delete: { icon: FolderX, label: 'Delete Namespace', color: 'text-red-600' },
  manifest_apply: { icon: FileCode, label: 'Apply Manifest', color: 'text-blue-500' },
};

function getScenarioDescription(scenario: Scenario): string {
  switch (scenario.type) {
    case 'node_failure':
      return scenario.node_name ? `Node: ${scenario.node_name}` : 'Any node';
    case 'az_failure':
      return scenario.az_label ? `Zone: ${scenario.az_label}` : 'Availability zone';
    case 'scale_down':
      return `${scenario.target_key ?? 'resource'} -> ${scenario.replicas ?? 0} replicas`;
    case 'resource_delete':
      return `${scenario.namespace ? scenario.namespace + '/' : ''}${scenario.target_key ?? 'resource'}`;
    case 'namespace_delete':
      return scenario.namespace ?? 'namespace';
    case 'manifest_apply':
      return scenario.manifest_yaml
        ? `${scenario.manifest_yaml.slice(0, 40)}...`
        : 'YAML manifest';
    default:
      return scenario.type;
  }
}

export default function ScenarioList() {
  const { scenarios, removeScenario } = useSimulationStore();

  if (scenarios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12">
        <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
          <FlaskConical className="h-6 w-6 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
          No scenarios yet
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Add a scenario to start simulating
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2 overflow-y-auto">
      <AnimatePresence mode="popLayout">
        {scenarios.map((scenario, index) => {
          const meta = SCENARIO_META[scenario.type] ?? SCENARIO_META.node_failure;
          const Icon = meta.icon;
          return (
            <motion.div
              key={`${scenario.type}-${index}`}
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -20, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              layout
              className="group relative flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-3 py-2.5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="mt-0.5 h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {meta.label}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {getScenarioDescription(scenario)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeScenario(index)}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 h-5 w-5 rounded flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all"
                aria-label={`Remove scenario ${index + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
