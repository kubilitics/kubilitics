// A-CORE-014: Token Budget Enforcement UI — real data from /api/v1/budget/* endpoints.
import { useState, useCallback } from 'react';
import {
  useBudgetSummary,
  useBudgetLimits,
  useBudgetDetails,
  useBudgetEstimate,
  useBudgetReset,
} from '@/hooks/useBudget';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Zap,
  DollarSign,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Settings,
  Calculator,
  BarChart2,
  Loader2,
} from 'lucide-react';

// ─── Sub-tab type ────────────────────────────────────────────────────────────

type BudgetTab = 'overview' | 'usage' | 'limits' | 'estimator';

// ─── Helper components ───────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', accent ?? 'text-muted-foreground')} />}
      </div>
      <div className={cn('text-xl font-bold tabular-nums', accent ?? 'text-foreground')}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Circular gauge showing usage as a fraction (0–1). */
function UsageGauge({ fraction, label, colorClass }: { fraction: number; label: string; colorClass: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(fraction, 1) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 36 36)"
          className={colorClass}
        />
        <text x="36" y="40" textAnchor="middle" className="fill-foreground" fontSize="11" fontWeight="700">
          {Math.round(fraction * 100)}%
        </text>
      </svg>
      <span className="text-[11px] text-muted-foreground text-center">{label}</span>
    </div>
  );
}

function fmt$(n: number) {
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ userID }: { userID: string }) {
  const { data, loading, error, refresh } = useBudgetSummary(userID, { pollIntervalMs: 15_000 });

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const usedFraction = data.budget_limit_usd > 0 ? data.total_cost_usd / data.budget_limit_usd : 0;
  const gaugeColor =
    usedFraction >= 0.9
      ? 'stroke-red-500'
      : usedFraction >= 0.7
      ? 'stroke-amber-500'
      : 'stroke-violet-500';

  const providers = Object.entries(data.by_provider ?? {});
  const investigations = Object.entries(data.by_investigation ?? {});

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold text-foreground">Budget Overview</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Warning banner */}
      {data.budget_limit_usd > 0 && usedFraction >= 0.8 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Budget is {Math.round(usedFraction * 100)}% consumed. Remaining:{' '}
            <strong>{fmt$(data.remaining_usd)}</strong>
          </span>
        </div>
      )}

      {/* Gauge + stat cards */}
      <div className="flex gap-4 items-start">
        {data.budget_limit_usd > 0 && (
          <div className="shrink-0">
            <UsageGauge
              fraction={usedFraction}
              label={`of ${fmt$(data.budget_limit_usd)}`}
              colorClass={gaugeColor}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 flex-1">
          <StatCard
            label="Total Spent"
            value={fmt$(data.total_cost_usd)}
            sub={`${fmtTokens(data.total_tokens)} tokens`}
            accent="text-violet-500"
            icon={DollarSign}
          />
          <StatCard
            label="Remaining"
            value={data.budget_limit_usd > 0 ? fmt$(data.remaining_usd) : '∞'}
            sub={data.budget_limit_usd > 0 ? `of ${fmt$(data.budget_limit_usd)}` : 'No limit set'}
            accent={usedFraction >= 0.9 ? 'text-red-500' : 'text-emerald-500'}
            icon={TrendingUp}
          />
          <StatCard
            label="Input Tokens"
            value={fmtTokens(data.total_input_tokens)}
            accent="text-blue-500"
            icon={Zap}
          />
          <StatCard
            label="Output Tokens"
            value={fmtTokens(data.total_output_tokens)}
            accent="text-purple-500"
            icon={Zap}
          />
        </div>
      </div>

      {/* By Provider */}
      {providers.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Cost by Provider
          </div>
          <div className="space-y-1.5">
            {providers.map(([provider, cost]) => {
              const frac = data.total_cost_usd > 0 ? (cost as number) / data.total_cost_usd : 0;
              return (
                <div key={provider} className="flex items-center gap-2">
                  <div className="w-20 shrink-0 text-xs font-medium capitalize">{provider}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${Math.round(frac * 100)}%` }}
                    />
                  </div>
                  <div className="w-16 text-right text-[11px] text-muted-foreground tabular-nums">
                    {fmt$(cost as number)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By Investigation (top 5) */}
      {investigations.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Top Investigations
          </div>
          <div className="space-y-1">
            {investigations.slice(0, 5).map(([inv, cost]) => (
              <div key={inv} className="flex items-center justify-between text-xs py-1 border-b border-border/50">
                <span className="text-muted-foreground truncate max-w-[60%] font-mono">{inv || '(global)'}</span>
                <span className="font-semibold tabular-nums">{fmt$(cost as number)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">
        Period start: {data.period_start ? new Date(data.period_start).toLocaleDateString() : '—'} · auto-refreshes every 15s
      </div>
    </div>
  );
}

// ─── Usage Tab ────────────────────────────────────────────────────────────────

function UsageTab({ userID }: { userID: string }) {
  const [invFilter, setInvFilter] = useState('');
  const { entries, loading, error, refresh } = useBudgetDetails(userID, invFilter);

  // Group by investigation
  const grouped = entries.reduce<Record<string, typeof entries>>((acc, e) => {
    const key = e.InvestigationID || '(global)';
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold">Usage Details</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-500"
          placeholder="Filter by investigation ID…"
          value={invFilter}
          onChange={(e) => setInvFilter(e.target.value)}
        />
      </div>

      {loading && !entries.length ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-xs text-destructive">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">No usage entries recorded yet.</div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([inv, items]) => {
            const totalCost = items.reduce((s, e) => s + e.CostUSD, 0);
            const totalIn = items.reduce((s, e) => s + e.InputTokens, 0);
            const totalOut = items.reduce((s, e) => s + e.OutputTokens, 0);
            return (
              <div key={inv} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-foreground truncate max-w-[60%]">{inv}</span>
                  <Badge variant="outline" className="text-violet-500 border-violet-500/30 text-[10px]">
                    {fmt$(totalCost)}
                  </Badge>
                </div>
                <div className="flex gap-4 text-[11px] text-muted-foreground">
                  <span>In: <strong className="text-foreground">{fmtTokens(totalIn)}</strong></span>
                  <span>Out: <strong className="text-foreground">{fmtTokens(totalOut)}</strong></span>
                  <span>Entries: <strong className="text-foreground">{items.length}</strong></span>
                </div>
                {/* Last 3 entries */}
                <div className="space-y-0.5">
                  {items.slice(-3).reverse().map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] text-muted-foreground py-0.5 border-b border-border/30 last:border-0">
                      <span className="capitalize">{e.Provider}</span>
                      <span>{fmtTokens(e.InputTokens + e.OutputTokens)} tok</span>
                      <span className="tabular-nums">{fmt$(e.CostUSD)}</span>
                      <span>{new Date(e.Timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Limits Tab ───────────────────────────────────────────────────────────────

function LimitsTab({ userID }: { userID: string }) {
  const { data, loading, error, setLimit } = useBudgetLimits(userID);
  const { resetBudget, loading: resetting } = useBudgetReset();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const handleSave = async () => {
    const val = parseFloat(draft);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    await setLimit(val);
    setSaving(false);
    setDraft('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    await resetBudget(userID);
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-violet-500" />
        <span className="text-sm font-semibold">Budget Limits</span>
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : error ? (
        <div className="text-xs text-destructive">{error}</div>
      ) : data ? (
        <div className="space-y-4">
          {/* Current state */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Limit"
              value={data.limit_usd > 0 ? fmt$(data.limit_usd) : 'None'}
              accent="text-violet-500"
              icon={Settings}
            />
            <StatCard
              label="Spent"
              value={fmt$(data.spent_usd)}
              accent="text-amber-500"
              icon={DollarSign}
            />
            <StatCard
              label="Remaining"
              value={data.limit_usd > 0 ? fmt$(data.remaining_usd) : '∞'}
              accent="text-emerald-500"
              icon={TrendingUp}
            />
            <StatCard
              label="Warn at"
              value={`${Math.round((data.warn_threshold ?? 0.8) * 100)}%`}
              sub="of limit"
              accent="text-amber-500"
              icon={AlertTriangle}
            />
          </div>

          {/* Set new limit */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">Set New Limit</div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 10.00"
                  className="w-full rounded-md border border-border bg-background pl-7 pr-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-500"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                />
              </div>
              <Button
                size="sm"
                className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                disabled={saving || !draft}
                onClick={handleSave}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <CheckCircle className="h-3.5 w-3.5" /> : 'Save'}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Set to <strong>0</strong> to remove the limit. Limits reset on period start.
            </div>
          </div>

          {/* Reset period */}
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Reset Budget Period</div>
            <div className="text-[11px] text-muted-foreground">
              Clears all usage counters for this period. This cannot be undone.
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              disabled={resetting}
              onClick={handleReset}
            >
              {resetting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : resetDone ? (
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
              ) : null}
              {resetDone ? 'Reset!' : 'Reset Period'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Estimator Tab ────────────────────────────────────────────────────────────

const PROVIDERS = ['openai', 'anthropic', 'ollama', 'custom'] as const;

function EstimatorTab() {
  const { data, loading, error, estimate } = useBudgetEstimate();
  const [inputTokens, setInputTokens] = useState('1000');
  const [outputTokens, setOutputTokens] = useState('500');
  const [provider, setProvider] = useState<string>('openai');

  const handleEstimate = useCallback(async () => {
    const inp = parseInt(inputTokens, 10) || 0;
    const out = parseInt(outputTokens, 10) || 0;
    await estimate(inp, out, provider);
  }, [inputTokens, outputTokens, provider, estimate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-violet-500" />
        <span className="text-sm font-semibold">Cost Estimator</span>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {/* Provider */}
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Provider</label>
          <div className="flex gap-1.5 flex-wrap">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-all border',
                  provider === p
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-background border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Token inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Input Tokens</label>
            <input
              type="number"
              min="0"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-500"
              value={inputTokens}
              onChange={(e) => setInputTokens(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Output Tokens</label>
            <input
              type="number"
              min="0"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-500"
              value={outputTokens}
              onChange={(e) => setOutputTokens(e.target.value)}
            />
          </div>
        </div>

        <Button
          className="w-full bg-violet-600 hover:bg-violet-700 text-white h-8 text-xs"
          onClick={handleEstimate}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
          Estimate Cost
        </Button>
      </div>

      {/* Result */}
      {error && <div className="text-xs text-destructive">{error}</div>}

      {data && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-violet-500" />
            <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">Estimate Result</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-background p-2.5 space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase">Provider</div>
              <div className="text-sm font-semibold capitalize">{data.provider}</div>
            </div>
            <div className="rounded-md bg-background p-2.5 space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase">Estimated Cost</div>
              <div className="text-sm font-bold text-violet-600 dark:text-violet-400 tabular-nums">
                {fmt$(data.estimated_usd)}
              </div>
            </div>
            <div className="rounded-md bg-background p-2.5 space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase">Input Tokens</div>
              <div className="text-sm font-semibold tabular-nums">{fmtTokens(data.input_tokens)}</div>
            </div>
            <div className="rounded-md bg-background p-2.5 space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase">Output Tokens</div>
              <div className="text-sm font-semibold tabular-nums">{fmtTokens(data.output_tokens)}</div>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground text-center">
            Total tokens: <strong>{fmtTokens(data.total_tokens)}</strong> ·{' '}
            {data.estimated_usd === 0 ? 'Free / self-hosted provider' : 'Based on current provider pricing'}
          </div>
        </div>
      )}

      {/* Pricing reference */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground">Pricing Reference</div>
        <div className="space-y-1">
          {[
            { p: 'openai (gpt-4)', inp: '$0.03/1k', out: '$0.06/1k' },
            { p: 'anthropic (claude-3)', inp: '$0.008/1k', out: '$0.024/1k' },
            { p: 'ollama', inp: 'Free', out: 'Free' },
          ].map(({ p, inp, out }) => (
            <div key={p} className="flex items-center gap-2 text-[10px]">
              <span className="w-36 text-muted-foreground">{p}</span>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">in: {inp}</Badge>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">out: {out}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── BudgetPanel ──────────────────────────────────────────────────────────────

const USER_ID = 'global';

export function BudgetPanel() {
  const [activeTab, setActiveTab] = useState<BudgetTab>('overview');

  const tabs: { id: BudgetTab; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Zap },
    { id: 'usage', label: 'Usage', icon: BarChart2 },
    { id: 'limits', label: 'Limits', icon: Settings },
    { id: 'estimator', label: 'Estimator', icon: Calculator },
  ];

  return (
    <div className="space-y-4">
      {/* Panel header */}
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-violet-500/10">
          <Zap className="h-4 w-4 text-violet-500" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Token Budget</div>
          <div className="text-[11px] text-muted-foreground">LLM cost tracking &amp; enforcement</div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab userID={USER_ID} />}
        {activeTab === 'usage' && <UsageTab userID={USER_ID} />}
        {activeTab === 'limits' && <LimitsTab userID={USER_ID} />}
        {activeTab === 'estimator' && <EstimatorTab />}
      </div>
    </div>
  );
}
