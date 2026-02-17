import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  Monitor,
  Moon,
  Sun,
  Bell,
  BellOff,
  ZoomIn,
  Palette,
  Save,
  RotateCcw,
  CheckCircle2,
  Info,
  Server,
  Bot,
  Key,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  Zap,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { DEFAULT_BACKEND_BASE_URL } from '@/lib/backendConstants';
import {
  saveLLMProviderConfig,
  loadLLMProviderConfig,
  clearLLMProviderConfig,
  getAIInfo,
  type LLMProviderConfig,
} from '@/services/aiService';
import { useAutonomyLevel, useNamespaceOverrides, useApprovals, type PendingApproval } from '@/hooks/useAutonomy';

interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  defaultZoom: number;
  autoRefreshInterval: number;
  showNotifications: boolean;
  soundEnabled: boolean;
  compactMode: boolean;
  showMiniMap: boolean;
  animationsEnabled: boolean;
  defaultNamespace: string;
}

const defaultPreferences: UserPreferences = {
  theme: 'system',
  defaultZoom: 100,
  autoRefreshInterval: 30,
  showNotifications: true,
  soundEnabled: false,
  compactMode: false,
  showMiniMap: true,
  animationsEnabled: true,
  defaultNamespace: 'all',
};

const AI_PROVIDER_OPTIONS = [
  { value: 'none', label: 'None (AI disabled)' },
  { value: 'openai', label: 'OpenAI (GPT-4, GPT-3.5)' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
] as const;

// ─── Autonomy level config ────────────────────────────────────────────────────

const AUTONOMY_LEVELS = [
  {
    value: 1,
    name: 'Observe',
    label: 'Read-only',
    description: 'AI can read cluster state only. No actions, no recommendations executed.',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
  },
  {
    value: 2,
    name: 'Recommend',
    label: 'Suggest only',
    description: 'AI suggests actions. All executions require manual operator approval.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
  },
  {
    value: 3,
    name: 'Propose',
    label: 'Approve before act',
    description: 'AI proposes actions queued for human approval. Approved actions auto-execute.',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    dot: 'bg-indigo-500',
  },
  {
    value: 4,
    name: 'Act with Guard',
    label: 'Auto-act on low risk',
    description: 'Low-risk actions (restart, scale) run automatically. High-risk require approval.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  {
    value: 5,
    name: 'Full Autonomous',
    label: 'All actions auto',
    description: 'AI executes all permitted actions automatically. Safety policies still enforced.',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    dot: 'bg-rose-500',
  },
] as const;

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
};

function ApprovalRow({ approval, onApprove, onReject, acting }: {
  approval: PendingApproval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  acting: boolean;
}) {
  const isPending = approval.status === 'pending';
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-3 sm:flex-row sm:items-start ${
      isPending ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50/40 opacity-70'
    }`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800">{approval.operation}</span>
          {approval.namespace && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">{approval.namespace}</span>
          )}
          {approval.risk_level && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${RISK_BADGE[approval.risk_level] ?? 'bg-slate-100 text-slate-600'}`}>
              {approval.risk_level}
            </span>
          )}
          {!isPending && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
              approval.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>
              {approval.status}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{approval.description}</p>
        {approval.resource_id && (
          <p className="text-xs text-slate-500 font-mono">{approval.resource_id}</p>
        )}
        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(approval.created_at).toLocaleString()}
          {approval.resolved_by && ` · resolved by ${approval.resolved_by}`}
        </p>
      </div>
      {isPending && (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            onClick={() => onApprove(approval.id)}
            disabled={acting}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 border-red-300 text-red-700 hover:bg-red-50"
            onClick={() => onReject(approval.id)}
            disabled={acting}
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function AutonomySettingsSection() {
  const {
    level: globalLevel,
    loading: levelLoading,
    saving: levelSaving,
    setLevel,
  } = useAutonomyLevel('default');

  const {
    overrides,
    loading: overridesLoading,
    saving: overridesSaving,
    upsert: upsertOverride,
    remove: removeOverride,
  } = useNamespaceOverrides('default');

  const {
    approvals,
    pendingCount,
    loading: approvalsLoading,
    acting,
    approve,
    reject,
    reload: reloadApprovals,
  } = useApprovals('default', 15_000);

  // Namespace override form
  const [nsForm, setNsForm] = useState({ namespace: '', level: 2 });
  const [showNsForm, setShowNsForm] = useState(false);

  const handleSetLevel = async (v: number) => {
    await setLevel(v);
    toast.success(`Autonomy level set to ${AUTONOMY_LEVELS[v - 1]?.name ?? v}`);
  };

  const handleUpsertNs = async () => {
    if (!nsForm.namespace.trim()) return;
    await upsertOverride(nsForm.namespace.trim(), nsForm.level);
    setNsForm({ namespace: '', level: 2 });
    setShowNsForm(false);
    toast.success(`Override set for namespace "${nsForm.namespace.trim()}"`);
  };

  const handleRemoveNs = async (ns: string) => {
    await removeOverride(ns);
    toast.success(`Override removed for "${ns}"`);
  };

  const handleApprove = async (id: string) => {
    await approve(id);
    toast.success('Action approved');
  };

  const handleReject = async (id: string) => {
    await reject(id);
    toast.success('Action rejected');
  };

  const currentLevel = AUTONOMY_LEVELS.find(l => l.value === globalLevel) ?? AUTONOMY_LEVELS[1];

  return (
    <Card id="autonomy">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-indigo-600" />
          AI Autonomy Control
          {pendingCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              <Clock className="h-3 w-3" />
              {pendingCount} pending
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Control how autonomously the AI can act on your cluster. Lower levels require more human approval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Global level selector */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Global Autonomy Level</Label>
            {levelLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {AUTONOMY_LEVELS.map((l) => (
              <button
                key={l.value}
                onClick={() => handleSetLevel(l.value)}
                disabled={levelSaving}
                className={`relative flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 ${
                  globalLevel === l.value
                    ? `${l.border} ${l.bg} ring-2 ring-offset-1 ring-indigo-300/60 shadow-sm`
                    : 'border-slate-100 bg-white hover:bg-slate-50 hover:border-slate-200'
                }`}
              >
                <span className={`flex items-center gap-1.5 text-xs font-bold ${globalLevel === l.value ? l.color : 'text-slate-600'}`}>
                  <span className={`w-2 h-2 rounded-full ${l.dot}`} />
                  {l.name}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight">{l.label}</span>
                {globalLevel === l.value && (
                  <span className="absolute top-1.5 right-1.5">
                    <CheckCircle className="h-3 w-3 text-indigo-500" />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className={`rounded-xl border p-3 text-sm flex gap-2 items-start ${currentLevel.bg} ${currentLevel.border}`}>
            <Zap className={`h-4 w-4 mt-0.5 shrink-0 ${currentLevel.color}`} />
            <div>
              <span className={`font-semibold ${currentLevel.color}`}>{currentLevel.name}:</span>{' '}
              <span className="text-muted-foreground">{currentLevel.description}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Namespace overrides */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Namespace Overrides</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set a different autonomy level for specific namespaces (overrides the global setting)
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8"
              onClick={() => setShowNsForm(v => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Override
            </Button>
          </div>

          {showNsForm && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 flex flex-col gap-3">
              <div className="flex gap-3 items-end flex-wrap">
                <div className="flex-1 min-w-[160px] space-y-1">
                  <Label className="text-xs font-semibold">Namespace</Label>
                  <Input
                    placeholder="e.g. production"
                    value={nsForm.namespace}
                    onChange={(e) => setNsForm(f => ({ ...f, namespace: e.target.value }))}
                    className="h-8 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Level</Label>
                  <Select
                    value={String(nsForm.level)}
                    onValueChange={(v) => setNsForm(f => ({ ...f, level: Number(v) }))}
                  >
                    <SelectTrigger className="w-[180px] h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTONOMY_LEVELS.map(l => (
                        <SelectItem key={l.value} value={String(l.value)}>
                          {l.value} — {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={handleUpsertNs}
                  disabled={overridesSaving || !nsForm.namespace.trim()}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </div>
          )}

          {overridesLoading ? (
            <p className="text-xs text-muted-foreground">Loading overrides…</p>
          ) : overrides.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No namespace overrides configured. All namespaces use the global level.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
              {overrides.map((ovr) => {
                const lvl = AUTONOMY_LEVELS.find(l => l.value === ovr.level);
                return (
                  <div key={ovr.namespace} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                    <span className="font-mono text-sm font-semibold text-slate-800 flex-1">{ovr.namespace}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${lvl?.bg ?? 'bg-slate-100'} ${lvl?.color ?? 'text-slate-600'} border ${lvl?.border ?? 'border-slate-200'}`}>
                      {lvl?.name ?? ovr.level}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(ovr.updated_at).toLocaleDateString()}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                      onClick={() => handleRemoveNs(ovr.namespace)}
                      disabled={overridesSaving}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Separator />

        {/* Pending approvals */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold flex items-center gap-2">
                Pending AI Actions
                {pendingCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Actions proposed by the AI that require your approval to execute
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 h-8 text-slate-500"
              onClick={reloadApprovals}
              disabled={approvalsLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${approvalsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {approvalsLoading && approvals.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : approvals.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-6 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 opacity-60" />
              <p className="text-sm font-medium text-slate-600">No pending actions</p>
              <p className="text-xs text-muted-foreground">All AI actions have been resolved</p>
            </div>
          ) : (
            <div className="space-y-2">
              {approvals.map(approval => (
                <ApprovalRow
                  key={approval.id}
                  approval={approval}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  acting={acting}
                />
              ))}
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [hasChanges, setHasChanges] = useState(false);
  const backendBaseUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const setBackendBaseUrl = useBackendConfigStore((s) => s.setBackendBaseUrl);
  const [backendUrlInput, setBackendUrlInput] = useState(backendBaseUrl);
  const [backendUrlDirty, setBackendUrlDirty] = useState(false);

  // AI Provider Configuration
  const [aiConfig, setAiConfig] = useState<LLMProviderConfig>({ provider: 'none' });
  const [aiConfigDirty, setAiConfigDirty] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [aiTestLoading, setAiTestLoading] = useState(false);

  useEffect(() => {
    setBackendUrlInput(backendBaseUrl);
  }, [backendBaseUrl]);

  // Load preferences from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('kubilitics-preferences');
    if (saved) {
      try {
        setPreferences(JSON.parse(saved));
      } catch {
        // Use defaults
      }
    }
  }, []);

  // Track changes
  useEffect(() => {
    const saved = localStorage.getItem('kubilitics-preferences');
    const current = JSON.stringify(preferences);
    setHasChanges(saved !== current);
  }, [preferences]);

  // Load saved AI provider config
  useEffect(() => {
    const saved = loadLLMProviderConfig();
    if (saved) setAiConfig(saved);
  }, []);

  const handleAiConfigChange = (updates: Partial<LLMProviderConfig>) => {
    setAiConfig((prev) => ({ ...prev, ...updates }));
    setAiConfigDirty(true);
    setAiConnected(null);
  };

  const handleSaveAiConfig = () => {
    if (aiConfig.provider === 'none') {
      clearLLMProviderConfig();
    } else {
      saveLLMProviderConfig(aiConfig);
    }
    setAiConfigDirty(false);
    toast.success('AI provider settings saved');
  };

  const handleTestAiConnection = async () => {
    setAiTestLoading(true);
    setAiConnected(null);
    try {
      await getAIInfo();
      setAiConnected(true);
      toast.success('Connected to AI service');
    } catch {
      setAiConnected(false);
      toast.error('Failed to connect to AI service');
    } finally {
      setAiTestLoading(false);
    }
  };

  const handleSave = () => {
    localStorage.setItem('kubilitics-preferences', JSON.stringify(preferences));
    setHasChanges(false);
    toast.success('Settings saved successfully');
    
    // Apply theme immediately
    applyTheme(preferences.theme);
  };

  const handleReset = () => {
    setPreferences(defaultPreferences);
    localStorage.removeItem('kubilitics-preferences');
    applyTheme('system');
    toast.success('Settings reset to defaults');
  };

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  };

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
    
    // Apply theme changes immediately for preview
    if (key === 'theme') {
      applyTheme(value as 'light' | 'dark' | 'system');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 max-w-4xl"
    >
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <SettingsIcon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Customize your Kubilitics experience
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Badge variant="secondary" className="gap-1.5">
              <Info className="h-3 w-3" />
              Unsaved changes
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!hasChanges} className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>

      {/* Backend API (A3.5: configure backend URL; recovery from unreachable) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Backend API
          </CardTitle>
          <CardDescription>
            Kubilitics backend base URL. When set (or when using default on this device), clusters load from the backend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="backend-url">Backend base URL</Label>
            <Input
              id="backend-url"
              type="url"
              placeholder={DEFAULT_BACKEND_BASE_URL}
              value={backendUrlInput}
              onChange={(e) => {
                setBackendUrlInput(e.target.value.trim());
                setBackendUrlDirty(e.target.value.trim() !== backendBaseUrl);
              }}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use default on this device ({DEFAULT_BACKEND_BASE_URL} when running locally or in the desktop app).
            </p>
          </div>
          {backendUrlDirty && (
            <Button
              size="sm"
              onClick={() => {
                setBackendBaseUrl(backendUrlInput);
                setBackendUrlDirty(false);
                toast.success('Backend URL saved');
              }}
            >
              Save backend URL
            </Button>
          )}
        </CardContent>
      </Card>

      {/* AI Provider Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Configuration
          </CardTitle>
          <CardDescription>
            Configure your LLM provider for AI-powered insights, anomaly detection, and the AI assistant.
            Bring your own API key — Kubilitics does not bundle any API keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Provider selection */}
          <div className="space-y-2">
            <Label htmlFor="ai-provider">AI Provider</Label>
            <Select
              value={aiConfig.provider}
              onValueChange={(v) => handleAiConfigChange({ provider: v as LLMProviderConfig['provider'] })}
            >
              <SelectTrigger id="ai-provider" className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model */}
          {aiConfig.provider !== 'none' && (
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                placeholder={
                  aiConfig.provider === 'openai' ? 'gpt-4o' :
                  aiConfig.provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' :
                  aiConfig.provider === 'ollama' ? 'llama3' : 'your-model-name'
                }
                value={aiConfig.model ?? ''}
                onChange={(e) => handleAiConfigChange({ model: e.target.value })}
                className="max-w-xs font-mono"
              />
            </div>
          )}

          {/* API Key (OpenAI / Anthropic) */}
          {(aiConfig.provider === 'openai' || aiConfig.provider === 'anthropic') && (
            <div className="space-y-2">
              <Label htmlFor="ai-api-key">API Key</Label>
              <div className="relative max-w-sm">
                <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="ai-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={aiConfig.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                  value={aiConfig.api_key ?? ''}
                  onChange={(e) => handleAiConfigChange({ api_key: e.target.value })}
                  className="pl-9 pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored in browser local storage. Never sent to Kubilitics servers.
              </p>
            </div>
          )}

          {/* Base URL (Ollama / Custom) */}
          {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                type="url"
                placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:8000/v1'}
                value={aiConfig.base_url ?? ''}
                onChange={(e) => handleAiConfigChange({ base_url: e.target.value })}
                className="max-w-sm font-mono"
              />
            </div>
          )}

          {/* API Key for custom (optional) */}
          {aiConfig.provider === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor="ai-custom-key">API Key (optional)</Label>
              <div className="relative max-w-sm">
                <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="ai-custom-key"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="Optional bearer token"
                  value={aiConfig.api_key ?? ''}
                  onChange={(e) => handleAiConfigChange({ api_key: e.target.value })}
                  className="pl-9 pr-9 font-mono"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          {aiConfig.provider !== 'none' && (
            <div className="flex items-center gap-3 pt-1">
              {aiConfigDirty && (
                <Button size="sm" onClick={handleSaveAiConfig} className="gap-2">
                  <Save className="h-4 w-4" />
                  Save AI Config
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestAiConnection}
                disabled={aiTestLoading}
                className="gap-2"
              >
                {aiTestLoading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : aiConnected === true ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : aiConnected === false ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
                Test Connection
              </Button>
              {aiConnected === true && (
                <span className="text-sm text-green-600 dark:text-green-400">Connected</span>
              )}
              {aiConnected === false && (
                <span className="text-sm text-destructive">Connection failed</span>
              )}
            </div>
          )}
          {aiConfig.provider === 'none' && (
            <p className="text-sm text-muted-foreground">
              Select a provider above to enable AI features. Analytics without LLM still works.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Appearance
          </CardTitle>
          <CardDescription>
            Customize the look and feel of Kubilitics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Theme */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Theme</Label>
              <p className="text-xs text-muted-foreground">
                Choose your preferred color scheme
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={preferences.theme === 'light' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => updatePreference('theme', 'light')}
              >
                <Sun className="h-4 w-4" />
                Light
              </Button>
              <Button
                variant={preferences.theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => updatePreference('theme', 'dark')}
              >
                <Moon className="h-4 w-4" />
                Dark
              </Button>
              <Button
                variant={preferences.theme === 'system' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => updatePreference('theme', 'system')}
              >
                <Monitor className="h-4 w-4" />
                System
              </Button>
            </div>
          </div>

          <Separator />

          {/* Compact Mode */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Compact Mode</Label>
              <p className="text-xs text-muted-foreground">
                Use smaller spacing and fonts for denser views
              </p>
            </div>
            <Switch
              checked={preferences.compactMode}
              onCheckedChange={(checked) => updatePreference('compactMode', checked)}
            />
          </div>

          <Separator />

          {/* Animations */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Animations</Label>
              <p className="text-xs text-muted-foreground">
                Enable smooth transitions and animations
              </p>
            </div>
            <Switch
              checked={preferences.animationsEnabled}
              onCheckedChange={(checked) => updatePreference('animationsEnabled', checked)}
            />
          </div>
        </CardContent>
      </Card>


      {/* Notifications Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
          <CardDescription>
            Configure alerts and notification preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Show Notifications */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Desktop Notifications</Label>
              <p className="text-xs text-muted-foreground">
                Show browser notifications for important events
              </p>
            </div>
            <Switch
              checked={preferences.showNotifications}
              onCheckedChange={(checked) => updatePreference('showNotifications', checked)}
            />
          </div>

          <Separator />

          {/* Sound */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Sound Alerts</Label>
              <p className="text-xs text-muted-foreground">
                Play sound for critical alerts
              </p>
            </div>
            <Switch
              checked={preferences.soundEnabled}
              onCheckedChange={(checked) => updatePreference('soundEnabled', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Data Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Data & Refresh
          </CardTitle>
          <CardDescription>
            Configure data fetching and defaults
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Auto Refresh Interval */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Auto Refresh Interval</Label>
              <p className="text-xs text-muted-foreground">
                How often to refresh resource data
              </p>
            </div>
            <Select
              value={String(preferences.autoRefreshInterval)}
              onValueChange={(value) => updatePreference('autoRefreshInterval', Number(value))}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 seconds</SelectItem>
                <SelectItem value="30">30 seconds</SelectItem>
                <SelectItem value="60">1 minute</SelectItem>
                <SelectItem value="300">5 minutes</SelectItem>
                <SelectItem value="0">Manual only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Default Namespace */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Default Namespace</Label>
              <p className="text-xs text-muted-foreground">
                Default namespace filter for resource views
              </p>
            </div>
            <Select
              value={preferences.defaultNamespace}
              onValueChange={(value) => updatePreference('defaultNamespace', value)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Namespaces</SelectItem>
                <SelectItem value="default">default</SelectItem>
                <SelectItem value="kube-system">kube-system</SelectItem>
                <SelectItem value="production">production</SelectItem>
                <SelectItem value="staging">staging</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* AI Autonomy — E-PLAT-003 */}
      <AutonomySettingsSection />

      {/* Save Reminder */}
      {hasChanges && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 right-6 bg-card border border-border rounded-lg shadow-lg p-4 flex items-center gap-3"
        >
          <Info className="h-5 w-5 text-primary" />
          <span className="text-sm">You have unsaved changes</span>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="h-4 w-4" />
            Save
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
