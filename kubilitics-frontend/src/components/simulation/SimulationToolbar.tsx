/**
 * SimulationToolbar — Top toolbar for the What-If Simulation page.
 *
 * Provides:
 * - Scenario type dropdown (6 options with icons)
 * - Dynamic target selector (varies by scenario type)
 * - Add / Run / Clear buttons
 * - Auto-run toggle
 */
import { useState, useCallback } from 'react';
import {
  Server,
  Globe,
  ArrowDown,
  Trash2,
  FolderX,
  FileCode,
  Plus,
  Play,
  Loader2,
  RotateCcw,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSimulationStore } from '@/stores/simulationStore';
import type { Scenario } from '@/services/api/simulation';

// ── Scenario type definitions with icons ─────────────────────────────────────

const SCENARIO_OPTIONS = [
  { type: 'node_failure' as const, label: 'Node Failure', icon: Server, description: 'Simulate a node going down' },
  { type: 'az_failure' as const, label: 'AZ Failure', icon: Globe, description: 'Simulate an availability zone outage' },
  { type: 'scale_change' as const, label: 'Scale Change', icon: ArrowDown, description: 'Change replica count' },
  { type: 'delete_resource' as const, label: 'Delete Resource', icon: Trash2, description: 'Remove a specific resource' },
  { type: 'delete_namespace' as const, label: 'Delete Namespace', icon: FolderX, description: 'Remove an entire namespace' },
  { type: 'deploy_new' as const, label: 'Deploy New', icon: FileCode, description: 'Apply a YAML manifest' },
] as const;

interface SimulationToolbarProps {
  onRunSimulation: () => void;
  isRunning: boolean;
  /** Available node names for the node_failure target selector */
  nodeNames?: string[];
  /** Available namespaces for namespace-related target selectors */
  namespaces?: string[];
  /** Available resource keys (Kind/Namespace/Name) for delete_resource selector */
  resourceKeys?: string[];
}

export default function SimulationToolbar({
  onRunSimulation,
  isRunning,
  nodeNames = [],
  namespaces = [],
  resourceKeys = [],
}: SimulationToolbarProps) {
  const { scenarios, addScenario, clearScenarios, autoRun, toggleAutoRun } = useSimulationStore();
  const [selectedType, setSelectedType] = useState<Scenario['type']>('node_failure');
  const [targetKey, setTargetKey] = useState('');
  const [namespace, setNamespace] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [azLabel, setAzLabel] = useState('');
  const [replicas, setReplicas] = useState(1);
  const [manifestYaml, setManifestYaml] = useState('');

  const resetInputs = useCallback(() => {
    setTargetKey('');
    setNamespace('');
    setNodeName('');
    setAzLabel('');
    setReplicas(1);
    setManifestYaml('');
  }, []);

  const handleAdd = useCallback(() => {
    const scenario: Scenario = { type: selectedType };

    switch (selectedType) {
      case 'node_failure':
        scenario.node_name = nodeName || undefined;
        break;
      case 'az_failure':
        scenario.az_label = azLabel || undefined;
        break;
      case 'scale_change':
        scenario.target_key = targetKey || undefined;
        scenario.namespace = namespace || undefined;
        scenario.replicas = replicas;
        break;
      case 'delete_resource':
        scenario.target_key = targetKey || undefined;
        scenario.namespace = namespace || undefined;
        break;
      case 'delete_namespace':
        scenario.namespace = namespace || undefined;
        break;
      case 'deploy_new':
        scenario.manifest_yaml = manifestYaml || undefined;
        break;
    }

    addScenario(scenario);
    resetInputs();
  }, [selectedType, nodeName, azLabel, targetKey, namespace, replicas, manifestYaml, addScenario, resetInputs]);

  const currentOption = SCENARIO_OPTIONS.find((o) => o.type === selectedType) ?? SCENARIO_OPTIONS[0];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm">
      {/* Scenario type selector */}
      <div className="relative">
        <select
          value={selectedType}
          onChange={(e) => {
            setSelectedType(e.target.value as Scenario['type']);
            resetInputs();
          }}
          className="appearance-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {SCENARIO_OPTIONS.map((opt) => (
            <option key={opt.type} value={opt.type}>
              {opt.label}
            </option>
          ))}
        </select>
        <currentOption.icon className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      </div>

      {/* Dynamic target inputs — vary by scenario type */}
      {selectedType === 'node_failure' && (
        <select
          value={nodeName}
          onChange={(e) => setNodeName(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
        >
          <option value="">Select node...</option>
          {nodeNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      )}

      {selectedType === 'az_failure' && (
        <input
          type="text"
          placeholder="AZ label (e.g. us-east-1a)"
          value={azLabel}
          onChange={(e) => setAzLabel(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
        />
      )}

      {(selectedType === 'scale_change' || selectedType === 'delete_resource') && (
        <>
          <select
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[120px]"
          >
            <option value="">Namespace...</option>
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
          <select
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
          >
            <option value="">Select resource...</option>
            {resourceKeys
              .filter((k) => !namespace || k.includes(`/${namespace}/`))
              .sort()
              .map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
          </select>
        </>
      )}

      {selectedType === 'scale_change' && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Replicas:</label>
          <input
            type="number"
            min={0}
            max={100}
            value={replicas}
            onChange={(e) => setReplicas(Number(e.target.value))}
            className="w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {selectedType === 'delete_namespace' && (
        <select
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
        >
          <option value="">Select namespace...</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
      )}

      {selectedType === 'deploy_new' && (
        <textarea
          placeholder="Paste YAML manifest..."
          value={manifestYaml}
          onChange={(e) => setManifestYaml(e.target.value)}
          rows={1}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[240px] resize-y"
        />
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>

        <button
          type="button"
          onClick={onRunSimulation}
          disabled={isRunning || scenarios.length === 0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
            isRunning || scenarios.length === 0
              ? "bg-slate-400 dark:bg-slate-600 cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
          )}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isRunning ? 'Running...' : 'Run Simulation'}
        </button>

        <button
          type="button"
          onClick={clearScenarios}
          disabled={scenarios.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Clear
        </button>

        {/* Auto-run toggle */}
        <button
          type="button"
          onClick={toggleAutoRun}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          title={autoRun ? 'Auto-run enabled' : 'Auto-run disabled'}
        >
          {autoRun ? (
            <ToggleRight className="h-4 w-4 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-slate-400" />
          )}
          <span className="text-xs">Auto</span>
        </button>
      </div>
    </div>
  );
}
