/**
 * SafetyPanel — World-class Safety & Autonomy Control UI for A-CORE-006.
 *
 * Features:
 *  - Autonomy level selector with animated slider + visual risk indicator
 *  - Immutable rules viewer with severity badges
 *  - Custom policy manager (create / delete)
 *  - Real-time safety evaluation playground
 *  - Policy check results with pass/fail indicators
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Eye,
  RefreshCw,
  Info,
  Settings,
  FlaskConical,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import {
  useImmutableRules,
  useSafetyPolicies,
  useAutonomyLevel,
  useSafetyEvaluate,
  AUTONOMY_LEVELS,
  type SafetyPolicy,
  type SafetyEvaluationResult,
} from '../../hooks/useAutonomy';

// ─── AutonomySlider ───────────────────────────────────────────────────────────

function AutonomySlider({
  level,
  saving,
  onSelect,
}: {
  level: number;
  saving: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Track */}
      <div className="relative h-2 bg-slate-700 rounded-full overflow-visible">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-slate-500 via-blue-500 via-cyan-500 via-amber-500 to-red-500"
          animate={{ width: `${(level / 4) * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />
        {AUTONOMY_LEVELS.map(al => (
          <button
            key={al.level}
            onClick={() => onSelect(al.level)}
            className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2"
            style={{ left: `${(al.level / 4) * 100}%` }}
            disabled={saving}
          >
            <motion.div
              className={[
                'w-4 h-4 rounded-full border-2 transition-all',
                level === al.level
                  ? `${al.bg} border-current ${al.color} shadow-lg`
                  : 'bg-slate-800 border-slate-600',
              ].join(' ')}
              animate={level === al.level ? { scale: 1.3 } : { scale: 1 }}
            />
          </button>
        ))}
      </div>

      {/* Labels */}
      <div className="flex justify-between">
        {AUTONOMY_LEVELS.map(al => (
          <button
            key={al.level}
            onClick={() => onSelect(al.level)}
            className={[
              'flex-1 text-center text-[9px] font-medium transition-colors px-0.5',
              level === al.level ? al.color : 'text-slate-600 hover:text-slate-400',
            ].join(' ')}
          >
            {al.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── AutonomyCard ─────────────────────────────────────────────────────────────

function AutonomyCard({ userID = 'default' }: { userID?: string }) {
  const { level, loading, error, saving, setLevel } = useAutonomyLevel(userID);
  const currentDef = AUTONOMY_LEVELS[Math.min(level, 4)];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading autonomy level…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current level display */}
      <div className={`rounded-xl border ${currentDef.border} ${currentDef.bg} p-4`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{currentDef.icon}</span>
            <div>
              <div className={`text-sm font-bold ${currentDef.color}`}>{currentDef.label}</div>
              <div className="text-[10px] text-slate-500">Level {level} of 4</div>
            </div>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">{currentDef.description}</p>
      </div>

      {/* Slider */}
      <AutonomySlider level={level} saving={saving} onSelect={setLevel} />

      {/* Level cards */}
      <div className="space-y-1.5">
        {AUTONOMY_LEVELS.map(al => (
          <button
            key={al.level}
            onClick={() => setLevel(al.level)}
            className={[
              'w-full flex items-center gap-3 rounded-lg border p-2.5 text-left transition-all',
              level === al.level
                ? `${al.bg} ${al.border} ${al.color}`
                : 'border-slate-700/50 bg-slate-800/30 text-slate-500 hover:border-slate-600 hover:text-slate-300',
            ].join(' ')}
          >
            <span className="text-base w-6 text-center">{al.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold leading-tight">{al.label}</div>
              <div className="text-[9px] opacity-70 truncate leading-tight mt-0.5">{al.description.slice(0, 60)}…</div>
            </div>
            {level === al.level && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-red-400 text-[10px]">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}

// ─── ImmutableRulesPanel ──────────────────────────────────────────────────────

function ImmutableRulesPanel() {
  const { rules, loading, error, reload } = useImmutableRules();

  // Friendly labels for known rule names
  const ruleLabels: Record<string, { label: string; desc: string; severity: string }> = {
    'no_production_namespace_delete':  { label: 'Production Delete Protection', desc: 'Prevents deletion of resources in production/prod namespaces', severity: 'critical' },
    'no_scale_to_zero_production':     { label: 'No Scale-to-Zero in Production', desc: 'Prevents scaling services to 0 replicas in production', severity: 'critical' },
    'no_kube_system_mutations':        { label: 'kube-system Protection', desc: 'Prevents mutations (delete/patch/scale) in kube-system namespace', severity: 'high' },
  };

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'critical': return 'bg-red-500/20 text-red-300 border-red-500/40';
      case 'high':     return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
      default:         return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Loading rules…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs text-red-400">{error}</div>
        <Button variant="ghost" size="sm" onClick={reload} className="self-start text-xs">
          <RefreshCw className="h-3 w-3 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Lock className="h-3.5 w-3.5 text-red-400" />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">
          Immutable — Cannot be disabled
        </span>
      </div>
      {rules.map((rule, i) => {
        const meta = ruleLabels[rule] || { label: rule, desc: 'System-enforced safety rule', severity: 'high' };
        return (
          <motion.div
            key={rule}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`rounded-lg border p-3 ${severityColor(meta.severity)}`}
          >
            <div className="flex items-start gap-2">
              <Lock className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] font-semibold">{meta.label}</span>
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 border-current ${severityColor(meta.severity)}`}>
                    {meta.severity}
                  </Badge>
                </div>
                <p className="text-[10px] opacity-80 leading-relaxed">{meta.desc}</p>
                <code className="text-[9px] opacity-50 font-mono mt-1 block">{rule}</code>
              </div>
            </div>
          </motion.div>
        );
      })}
      {rules.length === 0 && (
        <div className="text-center py-4 text-slate-500 text-xs">No immutable rules loaded</div>
      )}
    </div>
  );
}

// ─── PolicyManager ────────────────────────────────────────────────────────────

const POLICY_CONDITIONS = [
  { value: 'namespace=production', label: 'namespace = production' },
  { value: 'namespace=prod',       label: 'namespace = prod' },
  { value: 'namespace=staging',    label: 'namespace = staging' },
  { value: 'operation=delete',     label: 'operation = delete' },
  { value: 'operation=drain',      label: 'operation = drain' },
  { value: 'resource_type=Node',   label: 'resource_type = Node' },
];

function PolicyManager() {
  const { policies, loading, error, saving, createPolicy, deletePolicy } = useSafetyPolicies();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<SafetyPolicy>>({ effect: 'deny' });
  const [formError, setFormError] = useState('');

  const handleCreate = async () => {
    if (!form.name?.trim() || !form.condition?.trim() || !form.effect || !form.reason?.trim()) {
      setFormError('All fields are required');
      return;
    }
    setFormError('');
    await createPolicy(form as SafetyPolicy);
    setForm({ effect: 'deny' });
    setShowForm(false);
  };

  const effectColor = (effect: string) =>
    effect === 'deny'
      ? 'bg-red-500/20 text-red-300 border-red-500/40'
      : 'bg-amber-500/20 text-amber-300 border-amber-500/40';

  return (
    <div className="space-y-3">
      {/* Policy list */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-xs">Loading policies…</span>
        </div>
      ) : (
        <div className="space-y-2">
          {policies.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-2 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-semibold text-slate-200">{p.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${effectColor(p.effect)}`}>
                    {p.effect}
                  </span>
                </div>
                <code className="text-[10px] text-slate-400 block">{p.condition}</code>
                <p className="text-[10px] text-slate-500 mt-0.5">{p.reason}</p>
              </div>
              <button
                onClick={() => deletePolicy(p.name)}
                disabled={saving}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </motion.div>
          ))}
          {policies.length === 0 && (
            <div className="text-center py-4 text-slate-500 text-xs">
              No custom policies. Add one below.
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}

      {/* Add policy button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowForm(s => !s)}
        className="w-full text-xs border-slate-700 text-slate-400 hover:text-slate-200 gap-1.5"
      >
        {showForm ? <ChevronDown className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {showForm ? 'Cancel' : 'Add Policy'}
      </Button>

      {/* Create policy form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2.5 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                New Policy
              </p>

              {/* Name */}
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Policy Name</label>
                <Input
                  value={form.name ?? ''}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. block-staging-delete"
                  className="h-8 text-xs bg-slate-900 border-slate-700"
                />
              </div>

              {/* Condition */}
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Condition</label>
                <select
                  value={form.condition ?? ''}
                  onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                  className="w-full h-8 text-xs bg-slate-900 border border-slate-700 rounded-md px-2 text-slate-200"
                >
                  <option value="">Select or type below…</option>
                  {POLICY_CONDITIONS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <Input
                  value={form.condition ?? ''}
                  onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}
                  placeholder="namespace=staging or operation=delete"
                  className="h-8 text-xs bg-slate-900 border-slate-700 mt-1.5"
                />
              </div>

              {/* Effect */}
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Effect</label>
                <div className="flex gap-2">
                  {(['deny', 'warn'] as const).map(e => (
                    <button
                      key={e}
                      onClick={() => setForm(f => ({ ...f, effect: e }))}
                      className={[
                        'flex-1 text-[11px] font-medium rounded-lg py-1.5 border transition-all',
                        form.effect === e
                          ? e === 'deny'
                            ? 'bg-red-500/20 border-red-500/50 text-red-300'
                            : 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                          : 'border-slate-700 text-slate-500 hover:border-slate-600',
                      ].join(' ')}
                    >
                      {e === 'deny' ? '🚫 Deny' : '⚠️ Warn'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Reason</label>
                <Input
                  value={form.reason ?? ''}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Explain why this policy exists"
                  className="h-8 text-xs bg-slate-900 border-slate-700"
                />
              </div>

              {formError && <p className="text-[10px] text-red-400">{formError}</p>}

              <Button
                onClick={handleCreate}
                disabled={saving}
                size="sm"
                className="w-full text-xs bg-blue-600 hover:bg-blue-700"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Create Policy
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── EvaluationPlayground ─────────────────────────────────────────────────────

function EvaluationPlayground() {
  const { result, evaluating, error, evaluate } = useSafetyEvaluate();
  const [form, setForm] = useState({
    operation: 'scale',
    resource_type: 'Deployment',
    resource_name: 'my-app',
    namespace: 'default',
    justification: 'Testing safety evaluation',
  });

  const operations = ['restart', 'scale', 'delete', 'patch', 'drain', 'cordon', 'rollback', 'update_limits', 'hpa_scale'];

  const resultColor = (r: string) => {
    switch (r) {
      case 'approve': return 'border-green-500/40 bg-green-500/10';
      case 'deny':    return 'border-red-500/40 bg-red-500/10';
      case 'warn':    return 'border-amber-500/40 bg-amber-500/10';
      default:        return 'border-blue-500/40 bg-blue-500/10';
    }
  };

  const resultIcon = (r: string) => {
    switch (r) {
      case 'approve': return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case 'deny':    return <XCircle className="h-4 w-4 text-red-400" />;
      case 'warn':    return <AlertTriangle className="h-4 w-4 text-amber-400" />;
      default:        return <Info className="h-4 w-4 text-blue-400" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Action form */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Operation</label>
            <select
              value={form.operation}
              onChange={e => setForm(f => ({ ...f, operation: e.target.value }))}
              className="w-full h-8 text-xs bg-slate-900 border border-slate-700 rounded-md px-2 text-slate-200"
            >
              {operations.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Resource Type</label>
            <select
              value={form.resource_type}
              onChange={e => setForm(f => ({ ...f, resource_type: e.target.value }))}
              className="w-full h-8 text-xs bg-slate-900 border border-slate-700 rounded-md px-2 text-slate-200"
            >
              {['Pod', 'Deployment', 'StatefulSet', 'Node', 'Namespace', 'DaemonSet'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Name</label>
            <Input
              value={form.resource_name}
              onChange={e => setForm(f => ({ ...f, resource_name: e.target.value }))}
              className="h-8 text-xs bg-slate-900 border-slate-700"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Namespace</label>
            <Input
              value={form.namespace}
              onChange={e => setForm(f => ({ ...f, namespace: e.target.value }))}
              className="h-8 text-xs bg-slate-900 border-slate-700"
            />
          </div>
        </div>

        <Button
          onClick={() => evaluate({
            operation: form.operation,
            resource_type: form.resource_type,
            resource_name: form.resource_name,
            namespace: form.namespace,
            justification: form.justification,
            user_id: 'default',
          })}
          disabled={evaluating}
          size="sm"
          className="w-full text-xs bg-purple-600 hover:bg-purple-700 gap-1.5"
        >
          {evaluating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
          {evaluating ? 'Evaluating…' : 'Evaluate Action'}
        </Button>
      </div>

      {error && (
        <div className="text-[10px] text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </div>
      )}

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-4 space-y-3 ${resultColor(result.result)}`}
          >
            {/* Verdict */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {resultIcon(result.result)}
                <span className="text-sm font-bold capitalize text-slate-200">{result.result.replace('_', ' ')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500">Risk:</span>
                <RiskBadge level={result.risk_level} />
              </div>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">{result.reason}</p>

            {/* Policy checks */}
            {result.policy_checks?.length > 0 && (
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Policy Checks</div>
                <div className="space-y-1">
                  {result.policy_checks.map((pc, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {pc.passed
                        ? <CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" />
                        : <XCircle className="h-3 w-3 text-red-400 flex-shrink-0" />}
                      <span className="text-[10px] text-slate-400 flex-1">{pc.policy_name}</span>
                      <span className="text-[9px] text-slate-600 truncate max-w-24">{pc.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            {result.requires_human && (
              <div className="flex items-center gap-1.5 text-blue-300 text-[10px] bg-blue-500/10 rounded-lg px-2 py-1.5">
                <Info className="h-3 w-3" />
                Requires human approval before execution
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── RiskBadge ────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const styles = {
    critical: 'bg-red-500/20 text-red-300 border-red-500/40',
    high:     'bg-orange-500/20 text-orange-300 border-orange-500/40',
    medium:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
    low:      'bg-green-500/20 text-green-300 border-green-500/40',
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase ${styles[level as keyof typeof styles] ?? styles.medium}`}>
      {level}
    </span>
  );
}

// ─── SafetyPanel (main) ───────────────────────────────────────────────────────

type SafetyTab = 'autonomy' | 'rules' | 'policies' | 'evaluate';

export function SafetyPanel() {
  const [activeTab, setActiveTab] = useState<SafetyTab>('autonomy');

  const tabs: { id: SafetyTab; label: string; icon: React.ElementType }[] = [
    { id: 'autonomy', label: 'Autonomy',  icon: Zap },
    { id: 'rules',    label: 'Rules',     icon: Lock },
    { id: 'policies', label: 'Policies',  icon: Shield },
    { id: 'evaluate', label: 'Test',      icon: FlaskConical },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center">
          <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Safety Engine</h3>
          <p className="text-[10px] text-slate-500">Policy evaluation & autonomy control</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-800 px-4 flex-shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={[
              'flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-300',
            ].join(' ')}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <AnimatePresence mode="wait">
            {activeTab === 'autonomy' && (
              <motion.div key="autonomy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Autonomy Level
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600">
                    Controls how much the AI can execute autonomously vs. asking for human approval.
                  </p>
                </div>
                <AutonomyCard />
              </motion.div>
            )}

            {activeTab === 'rules' && (
              <motion.div key="rules" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lock className="h-3.5 w-3.5 text-red-400" />
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Immutable Safety Rules
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600">
                    These rules are enforced regardless of autonomy level or policy configuration.
                  </p>
                </div>
                <ImmutableRulesPanel />
              </motion.div>
            )}

            {activeTab === 'policies' && (
              <motion.div key="policies" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Custom Policies
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600">
                    Define namespace restrictions, operation denials, and custom guardrails.
                  </p>
                </div>
                <PolicyManager />
              </motion.div>
            )}

            {activeTab === 'evaluate' && (
              <motion.div key="evaluate" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <FlaskConical className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Safety Evaluation Playground
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600">
                    Test how the safety engine evaluates a proposed action against all rules and policies.
                  </p>
                </div>
                <EvaluationPlayground />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}

export default SafetyPanel;
