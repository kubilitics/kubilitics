import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Send,
  X,
  Sparkles,
  Maximize2,
  Minimize2,
  Copy,
  CheckCircle,
  Loader2,
  Terminal,
  Eye,
  Scale,
  Wifi,
  WifiOff,
  Trash2,
  Wrench,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Search,
  Activity,
  Shield,
  DollarSign,
  Zap,
  Settings2,
  Brain,
  Server,
  Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useWebSocket, type ToolEvent } from '@/hooks/useWebSocket';
import { buildChatWSUrl } from '@/services/aiService';
import { useLocation } from 'react-router-dom';
import { InvestigationPanel } from './InvestigationPanel';
import { SafetyPanel } from './SafetyPanel';
import { BackendConnectionPanel } from './BackendConnectionPanel';
import { MemoryPanel } from './MemoryPanel';
import { AnalyticsPanel } from './AnalyticsPanel';
import { CostPanel } from './CostPanel';
import { SecurityPanel } from './SecurityPanel';
import { PersistencePanel } from './PersistencePanel';
import { BudgetPanel } from './BudgetPanel';

interface ActionButton {
  label: string;
  action: string;
  variant: 'default' | 'outline' | 'secondary';
  icon?: string;
}

const suggestedQueries = [
  'Why is my pod crashing?',
  'Show pods with high CPU usage',
  'What deployments need attention?',
  'Find services without endpoints',
  'Explain PersistentVolumeClaims',
];

function getIconForAction(iconName?: string) {
  switch (iconName) {
    case 'check': return CheckCircle;
    case 'eye': return Eye;
    case 'scale': return Scale;
    default: return Terminal;
  }
}

/** Extract namespace / resource type / screen from the current URL path */
function useRouteContext() {
  const location = useLocation();
  return useCallback(() => {
    const parts = location.pathname.split('/');
    const namespaceIdx = parts.indexOf('namespaces');
    const namespace = namespaceIdx !== -1 ? parts[namespaceIdx + 1] : '';
    const resourceType = namespaceIdx !== -1 ? parts[namespaceIdx + 2] || '' : '';
    const screen = resourceType
      ? parts.length > namespaceIdx + 3
        ? `${resourceType}-detail`
        : `${resourceType}-list`
      : 'dashboard';
    return { namespace, resource: resourceType, screen };
  }, [location.pathname]);
}

// ─── Tool category helpers ─────────────────────────────────────────────────

const TOOL_CATEGORY_CONFIG: Record<string, {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ElementType;
  label: string;
}> = {
  observe:        { color: 'text-blue-600 dark:text-blue-400',   bgColor: 'bg-blue-500/8',    borderColor: 'border-blue-500/25',   icon: Eye,       label: 'Observe'    },
  analyze:        { color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-500/8', borderColor: 'border-purple-500/25', icon: Activity,  label: 'Analyze'    },
  troubleshoot:   { color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/8', borderColor: 'border-orange-500/25', icon: Search,    label: 'Troubleshoot' },
  recommend:      { color: 'text-cyan-600 dark:text-cyan-400',    bgColor: 'bg-cyan-500/8',    borderColor: 'border-cyan-500/25',   icon: Zap,       label: 'Recommend'  },
  security:       { color: 'text-red-600 dark:text-red-400',      bgColor: 'bg-red-500/8',     borderColor: 'border-red-500/25',    icon: Shield,    label: 'Security'   },
  cost:           { color: 'text-green-600 dark:text-green-400',  bgColor: 'bg-green-500/8',   borderColor: 'border-green-500/25',  icon: DollarSign, label: 'Cost'      },
  action:         { color: 'text-amber-600 dark:text-amber-400',  bgColor: 'bg-amber-500/8',   borderColor: 'border-amber-500/25',  icon: Terminal,  label: 'Action'     },
  automation:     { color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-500/8', borderColor: 'border-indigo-500/25', icon: Settings2, label: 'Automate'   },
  export:         { color: 'text-teal-600 dark:text-teal-400',    bgColor: 'bg-teal-500/8',    borderColor: 'border-teal-500/25',   icon: Eye,       label: 'Export'     },
};

function getToolCategory(toolName: string) {
  const prefix = toolName.split('_')[0];
  return TOOL_CATEGORY_CONFIG[prefix] ?? {
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-border',
    icon: Wrench,
    label: 'Tool',
  };
}

function humanizeToolName(toolName: string): string {
  return toolName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Analysis result card helpers ─────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: 'text-red-700 dark:text-red-400',    bg: 'bg-red-500/15',    label: 'Critical' },
  HIGH:     { color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/15', label: 'High' },
  MEDIUM:   { color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-500/15', label: 'Medium' },
  LOW:      { color: 'text-green-700 dark:text-green-400',  bg: 'bg-green-500/15',  label: 'Low' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CONFIG[severity?.toUpperCase()] ?? SEVERITY_CONFIG.LOW;
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide', cfg.color, cfg.bg)}>
      {cfg.label}
    </span>
  );
}

/** Radial security score gauge (SVG-based) */
function SecurityScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (clamped / 100) * circumference;
  const color = clamped >= 80 ? '#22c55e' : clamped >= 60 ? '#f59e0b' : clamped >= 40 ? '#f97316' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/20" />
        <circle
          cx="36" cy="36" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill={color}>
          {clamped}
        </text>
      </svg>
      <span className="text-[9px] text-muted-foreground">/ 100</span>
    </div>
  );
}

/** Slim horizontal progress bar */
function ProgressBar({ value, max, color = 'bg-green-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-full h-1 rounded-full bg-muted/30 overflow-hidden">
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Generic issue row for findings lists */
function IssueRow({ issue }: { issue: Record<string, unknown> }) {
  const sev = (issue.severity as string) ?? 'LOW';
  const msg = (issue.message as string) ?? JSON.stringify(issue);
  const type = (issue.type || issue.check) as string | undefined;
  return (
    <div className="flex items-start gap-1.5 py-1 border-b border-border/30 last:border-0">
      <SeverityBadge severity={sev} />
      <div className="flex-1 min-w-0">
        {type && <span className="text-[9px] font-semibold text-muted-foreground uppercase">{type} · </span>}
        <span className="text-[10px] text-foreground/80 break-words">{msg}</span>
      </div>
    </div>
  );
}

// ─── Specialized deep-analysis result renderers ───────────────────────────────

const DEEP_ANALYSIS_TOOLS = new Set([
  'analyze_pod_health', 'analyze_deployment_health', 'analyze_node_pressure',
  'detect_resource_contention', 'analyze_network_connectivity', 'analyze_rbac_permissions',
  'analyze_storage_health', 'check_resource_limits', 'analyze_hpa_behavior',
  'analyze_log_patterns', 'assess_security_posture', 'detect_configuration_drift',
]);

function AnalysisPodHealthCard({ data }: { data: Record<string, unknown> }) {
  const issues = (data.issues as Record<string, unknown>[]) ?? [];
  const healthy = (data.healthy as number) ?? 0;
  const total = (data.total_pods as number) ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">Healthy pods</span>
            <span className="font-semibold">{healthy}/{total}</span>
          </div>
          <ProgressBar value={healthy} max={total} color={healthy === total ? 'bg-green-500' : 'bg-amber-500'} />
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Issues</div>
          <div className={cn('text-sm font-bold', issues.length > 0 ? 'text-orange-500' : 'text-green-500')}>
            {issues.length}
          </div>
        </div>
      </div>
      {issues.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {issues.slice(0, 6).map((issue, i) => <IssueRow key={i} issue={issue} />)}
          {issues.length > 6 && (
            <div className="text-[9px] text-muted-foreground px-2 py-1">+{issues.length - 6} more issues</div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisDeploymentHealthCard({ data }: { data: Record<string, unknown> }) {
  const deployments = (data.deployments as Record<string, unknown>[]) ?? [];
  const healthColor = { Healthy: 'text-green-500', Degraded: 'text-amber-500', Critical: 'text-red-500' };
  return (
    <div className="space-y-1.5">
      {deployments.slice(0, 8).map((d, i) => {
        const health = (d.health as string) ?? 'Healthy';
        const desired = (d.desired_replicas as number) ?? 0;
        const ready = (d.ready_replicas as number) ?? 0;
        const issues = (d.issues as string[]) ?? [];
        return (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            <div className="w-2 h-2 rounded-full shrink-0" style={{
              background: health === 'Healthy' ? '#22c55e' : health === 'Degraded' ? '#f59e0b' : '#ef4444'
            }} />
            <span className="font-medium truncate flex-1">{d.name as string}</span>
            <span className={cn('font-semibold', healthColor[health as keyof typeof healthColor] ?? 'text-muted-foreground')}>
              {health}
            </span>
            <span className="text-muted-foreground shrink-0">{ready}/{desired}</span>
            {issues.length > 0 && <SeverityBadge severity="HIGH" />}
          </div>
        );
      })}
      {deployments.length > 8 && (
        <div className="text-[9px] text-muted-foreground">+{deployments.length - 8} more</div>
      )}
    </div>
  );
}

function AnalysisNodePressureCard({ data }: { data: Record<string, unknown> }) {
  const nodes = (data.nodes as Record<string, unknown>[]) ?? [];
  const underPressure = (data.nodes_under_pressure as number) ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{data.total_nodes as number} nodes</span>
        <span>·</span>
        <span className={underPressure > 0 ? 'text-red-500 font-semibold' : 'text-green-500'}>
          {underPressure} under pressure
        </span>
      </div>
      {nodes.filter(n => n.severity === 'HIGH').slice(0, 5).map((n, i) => {
        const pressures = (n.active_pressures as string[]) ?? [];
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
            <span className="font-medium truncate flex-1">{n.node as string}</span>
            <div className="flex gap-1">
              {pressures.map(p => (
                <span key={p} className="px-1 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-medium">
                  {p.replace('Pressure', '')}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AnalysisSecurityPostureCard({ data }: { data: Record<string, unknown> }) {
  const score = (data.security_score as number) ?? 100;
  const findings = (data.findings as Record<string, unknown>[]) ?? [];
  const riskLevel = (data.risk_level as string) ?? 'LOW';

  // Group findings by severity
  const bySeverity = findings.reduce<Record<string, number>>((acc, f) => {
    const sev = (f.severity as string) ?? 'LOW';
    acc[sev] = (acc[sev] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <SecurityScoreGauge score={score} />
        <div className="flex-1 space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Risk Level</span>
            <SeverityBadge severity={riskLevel} />
          </div>
          <div className="text-[10px] text-muted-foreground">{data.total_findings as number} findings</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(bySeverity).map(([sev, count]) => (
              <span key={sev} className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', SEVERITY_CONFIG[sev]?.color, SEVERITY_CONFIG[sev]?.bg)}>
                {count} {sev.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      </div>
      {findings.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            CIS Benchmark Findings
          </div>
          {findings.slice(0, 5).map((f, i) => (
            <div key={i} className="flex items-start gap-1.5 px-2 py-1.5 border-t border-border/20">
              <SeverityBadge severity={(f.severity as string)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-mono text-muted-foreground">{f.cis_id as string}</span>
                  <span className="text-[9px] font-semibold">{f.check as string}</span>
                </div>
                <div className="text-[9px] text-foreground/70 truncate">{f.message as string}</div>
              </div>
            </div>
          ))}
          {findings.length > 5 && (
            <div className="text-[9px] text-muted-foreground px-2 py-1">+{findings.length - 5} more findings</div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisStorageHealthCard({ data }: { data: Record<string, unknown> }) {
  const total = (data.total_pvcs as number) ?? 0;
  const bound = (data.bound_pvcs as number) ?? 0;
  const unbound = (data.unbound_pvcs as number) ?? 0;
  const isHealthy = (data.storage_health as string) === 'Healthy';
  const unbound_details = (data.unbound_details as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">Bound PVCs</span>
            <span className="font-semibold">{bound}/{total}</span>
          </div>
          <ProgressBar value={bound} max={total} color={isHealthy ? 'bg-green-500' : 'bg-red-500'} />
        </div>
        <span className={cn('text-xs font-bold', isHealthy ? 'text-green-500' : 'text-red-500')}>
          {data.storage_health as string}
        </span>
      </div>
      {unbound_details.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {unbound_details.slice(0, 4).map((pvc, i) => <IssueRow key={i} issue={pvc} />)}
        </div>
      )}
      {unbound > 0 && (
        <div className="text-[9px] text-orange-600 dark:text-orange-400">
          ⚠ {unbound} PVC{unbound > 1 ? 's' : ''} unbound — pods may fail to start
        </div>
      )}
    </div>
  );
}

function AnalysisRBACCard({ data }: { data: Record<string, unknown> }) {
  const overprivileged = (data.overprivileged_accounts as number) ?? 0;
  const findings = (data.findings as Record<string, unknown>[]) ?? [];
  const riskLevel = (data.risk_level as string) ?? 'LOW';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">Risk:</span>
        <SeverityBadge severity={riskLevel} />
        <span className="text-muted-foreground ml-auto">{overprivileged} over-privileged SAs</span>
      </div>
      {findings.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            RBAC Findings
          </div>
          {findings.slice(0, 4).map((f, i) => (
            <div key={i} className="px-2 py-1.5 border-t border-border/20 text-[10px]">
              <div className="flex items-center gap-1 mb-0.5">
                <SeverityBadge severity={(f.severity as string)} />
                <span className="font-mono font-medium">{f.service_account as string}</span>
                <span className="ml-auto px-1 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[9px]">
                  {f.role_name as string}
                </span>
              </div>
              {f.recommendation && (
                <div className="text-[9px] text-muted-foreground truncate">{f.recommendation as string}</div>
              )}
            </div>
          ))}
          {findings.length > 4 && (
            <div className="text-[9px] text-muted-foreground px-2 py-1">+{findings.length - 4} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisLogPatternsCard({ data }: { data: Record<string, unknown> }) {
  const errorCount = (data.error_count as number) ?? 0;
  const linesAnalysed = (data.lines_analysed as number) ?? 0;
  const severity = (data.severity as string) ?? 'LOW';
  const errorPatterns = (data.error_patterns as Record<string, number>) ?? {};
  const sampleErrors = (data.sample_errors as string[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="text-center">
          <div className={cn('text-lg font-bold', errorCount > 0 ? 'text-red-500' : 'text-green-500')}>{errorCount}</div>
          <div className="text-[9px] text-muted-foreground">errors</div>
        </div>
        <div className="flex-1 space-y-1">
          <div className="text-[10px] text-muted-foreground">{linesAnalysed} lines analysed · pod: <span className="font-mono">{data.pod as string}</span></div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">Severity:</span>
            <SeverityBadge severity={severity} />
          </div>
        </div>
      </div>
      {Object.keys(errorPatterns).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(errorPatterns).map(([kw, count]) => (
            <span key={kw} className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-[9px] font-medium">
              {kw}: {count}
            </span>
          ))}
        </div>
      )}
      {sampleErrors.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            Sample Errors
          </div>
          {sampleErrors.slice(0, 3).map((line, i) => (
            <div key={i} className="px-2 py-1 border-t border-border/20 text-[9px] font-mono text-foreground/70 truncate">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisDriftCard({ data }: { data: Record<string, unknown> }) {
  const hasDrift = (data.has_drift as boolean) ?? false;
  const driftCount = (data.drift_count as number) ?? 0;
  const drifts = (data.drifts as Record<string, unknown>[]) ?? [];
  const resource = (data.resource as string) ?? '';
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-mono text-muted-foreground truncate">{resource}</span>
        <div className={cn(
          'ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold',
          hasDrift ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : 'bg-green-500/15 text-green-600 dark:text-green-400'
        )}>
          {hasDrift ? '⚠ Drifted' : '✓ In Sync'}
        </div>
      </div>
      {drifts.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="px-2 py-1 bg-muted/20 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            {driftCount} field{driftCount > 1 ? 's' : ''} drifted
          </div>
          {drifts.slice(0, 6).map((d, i) => (
            <div key={i} className="px-2 py-1.5 border-t border-border/20 text-[9px]">
              <div className="font-mono text-purple-600 dark:text-purple-400 truncate">{d.path as string}</div>
              <div className="flex gap-2 mt-0.5">
                <span className="text-muted-foreground">want: <span className="text-foreground/80">{JSON.stringify(d.desired)}</span></span>
                <span className="text-muted-foreground">got: <span className="text-orange-500">{JSON.stringify(d.actual)}</span></span>
              </div>
            </div>
          ))}
          {drifts.length > 6 && (
            <div className="text-[9px] text-muted-foreground px-2 py-1">+{drifts.length - 6} more drifts</div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisHPACard({ data }: { data: Record<string, unknown> }) {
  const hpas = (data.hpas as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-muted-foreground">{data.total as number} HPAs in {data.namespace as string}</div>
      {hpas.slice(0, 5).map((hpa, i) => {
        const warnings = (hpa.warnings as string[]) ?? [];
        const current = hpa.current_replicas as number;
        const max = hpa.max_replicas as number;
        const atMax = hpa.at_max_replicas as boolean;
        return (
          <div key={i} className="border border-border/40 rounded-lg px-2 py-1.5 text-[10px]">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-medium truncate flex-1">{hpa.name as string}</span>
              <span className="text-muted-foreground">{current}/{max} replicas</span>
              {atMax && <SeverityBadge severity="MEDIUM" />}
            </div>
            {warnings.slice(0, 2).map((w, j) => (
              <div key={j} className="text-[9px] text-amber-600 dark:text-amber-400 truncate">⚡ {w}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AnalysisContentionCard({ data }: { data: Record<string, unknown> }) {
  const risk = (data.contention_risk as string) ?? 'LOW';
  const missingLimits = (data.pods_missing_limits as number) ?? 0;
  const missingRequests = (data.pods_missing_requests as number) ?? 0;
  const containers = (data.containers_missing_limits as string[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">Contention Risk:</span>
        <SeverityBadge severity={risk} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/40 px-2 py-1.5 text-center">
          <div className={cn('text-sm font-bold', missingLimits > 0 ? 'text-orange-500' : 'text-green-500')}>{missingLimits}</div>
          <div className="text-[9px] text-muted-foreground">missing limits</div>
        </div>
        <div className="rounded-lg border border-border/40 px-2 py-1.5 text-center">
          <div className={cn('text-sm font-bold', missingRequests > 0 ? 'text-amber-500' : 'text-green-500')}>{missingRequests}</div>
          <div className="text-[9px] text-muted-foreground">missing requests</div>
        </div>
      </div>
      {containers.length > 0 && (
        <div className="text-[9px] text-muted-foreground">
          {containers.slice(0, 3).join(', ')}{containers.length > 3 && ` +${containers.length - 3} more`}
        </div>
      )}
    </div>
  );
}

function AnalysisNetworkCard({ data }: { data: Record<string, unknown> }) {
  const services = (data.services as Record<string, unknown>[]) ?? [];
  const noEndpoints = services.filter(s => s.status === 'NO_ENDPOINTS');
  const netPolicies = (data.network_policies as number) ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px]">
        <span className="text-muted-foreground">{services.length} services</span>
        <span className={cn(noEndpoints.length > 0 ? 'text-red-500 font-semibold' : 'text-green-500')}>
          {noEndpoints.length} no-endpoint
        </span>
        <span className="text-muted-foreground ml-auto">{netPolicies} network policies</span>
      </div>
      {noEndpoints.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {noEndpoints.slice(0, 4).map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 border-b border-border/20 last:border-0 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
              <span className="font-mono truncate">{s.service as string}</span>
              <span className="ml-auto text-red-500 text-[9px]">NO_ENDPOINTS</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisResourceLimitsCard({ data }: { data: Record<string, unknown> }) {
  const totalPods = (data.total_pods as number) ?? 0;
  const violations = (data.violations as number) ?? 0;
  const complianceRate = (data.compliance_rate as string) ?? '100.0%';
  const violationList = (data.violation_list as Record<string, unknown>[]) ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">Compliance rate</span>
            <span className="font-semibold">{complianceRate}</span>
          </div>
          <ProgressBar
            value={totalPods - violations}
            max={totalPods}
            color={violations === 0 ? 'bg-green-500' : violations < 5 ? 'bg-amber-500' : 'bg-red-500'}
          />
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground">Violations</div>
          <div className={cn('text-sm font-bold', violations > 0 ? 'text-orange-500' : 'text-green-500')}>
            {violations}
          </div>
        </div>
      </div>
      {violationList.length > 0 && (
        <div className="border border-border/40 rounded-lg overflow-hidden">
          {violationList.slice(0, 4).map((v, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1 border-b border-border/20 last:border-0 text-[9px]">
              <SeverityBadge severity={(v.severity as string)} />
              <span className="font-mono truncate">{v.pod as string}/{v.container as string}</span>
              <span className="ml-auto text-muted-foreground">{(v.missing as string[]).join(', ')}</span>
            </div>
          ))}
          {violationList.length > 4 && (
            <div className="text-[9px] text-muted-foreground px-2 py-1">+{violationList.length - 4} more</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * AnalysisResultCard — routes to specialized UI based on tool name.
 * Falls back to the plain JSON renderer for unknown tools.
 */
function AnalysisResultCard({
  toolName,
  resultJson,
}: {
  toolName: string;
  resultJson: string;
}) {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(resultJson) as Record<string, unknown>;
  } catch {
    // not JSON — render raw
  }

  if (!parsed) {
    return (
      <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
        {resultJson}
      </pre>
    );
  }

  switch (toolName) {
    case 'analyze_pod_health':
      return <AnalysisPodHealthCard data={parsed} />;
    case 'analyze_deployment_health':
      return <AnalysisDeploymentHealthCard data={parsed} />;
    case 'analyze_node_pressure':
      return <AnalysisNodePressureCard data={parsed} />;
    case 'detect_resource_contention':
      return <AnalysisContentionCard data={parsed} />;
    case 'analyze_network_connectivity':
      return <AnalysisNetworkCard data={parsed} />;
    case 'analyze_rbac_permissions':
      return <AnalysisRBACCard data={parsed} />;
    case 'analyze_storage_health':
      return <AnalysisStorageHealthCard data={parsed} />;
    case 'check_resource_limits':
      return <AnalysisResourceLimitsCard data={parsed} />;
    case 'analyze_hpa_behavior':
      return <AnalysisHPACard data={parsed} />;
    case 'analyze_log_patterns':
      return <AnalysisLogPatternsCard data={parsed} />;
    case 'assess_security_posture':
      return <AnalysisSecurityPostureCard data={parsed} />;
    case 'detect_configuration_drift':
      return <AnalysisDriftCard data={parsed} />;
    default:
      return (
        <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
  }
}

// ─── Execution result cards (A-CORE-004) ─────────────────────────────────────

const EXECUTION_TOOLS = new Set([
  'restart_pod', 'scale_deployment', 'cordon_node', 'drain_node',
  'apply_resource_patch', 'delete_resource', 'rollback_deployment',
  'update_resource_limits', 'trigger_hpa_scale',
]);

const RISK_CONFIG: Record<string, { color: string; bg: string; ring: string }> = {
  low:      { color: 'text-green-700 dark:text-green-400',   bg: 'bg-green-500/12',  ring: 'ring-green-500/30' },
  medium:   { color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-500/12', ring: 'ring-yellow-500/30' },
  high:     { color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/12', ring: 'ring-orange-500/30' },
  critical: { color: 'text-red-700 dark:text-red-400',       bg: 'bg-red-500/12',    ring: 'ring-red-500/30' },
};

function RiskLevelBadge({ level }: { level: string }) {
  const cfg = RISK_CONFIG[level?.toLowerCase()] ?? RISK_CONFIG.medium;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ring-1',
      cfg.color, cfg.bg, cfg.ring
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', {
        'bg-green-500': level === 'low',
        'bg-yellow-500': level === 'medium',
        'bg-orange-500': level === 'high',
        'bg-red-500': level === 'critical',
      })} />
      {level ?? 'unknown'}
    </span>
  );
}

interface PolicyCheckRow {
  policy_name: string;
  passed: boolean;
  reason: string;
  severity: string;
}

function PolicyChecksList({ checks }: { checks: PolicyCheckRow[] }) {
  if (!checks?.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Policy Checks ({checks.length})
      </div>
      <div className="space-y-0.5">
        {checks.map((c, i) => (
          <div key={i} className={cn(
            'flex items-start gap-2 px-2 py-1 rounded text-[10px]',
            c.passed ? 'bg-green-500/8' : 'bg-red-500/8'
          )}>
            <span className={cn('shrink-0 mt-0.5', c.passed ? 'text-green-500' : 'text-red-500')}>
              {c.passed ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{c.policy_name}</div>
              {c.reason && <div className="text-muted-foreground text-[9px]">{c.reason}</div>}
            </div>
            <span className={cn('shrink-0 text-[9px] font-bold uppercase', {
              'text-red-500': c.severity === 'critical',
              'text-orange-500': c.severity === 'high',
              'text-yellow-500': c.severity === 'medium',
              'text-green-500': c.severity === 'low',
            })}>
              {c.severity}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Safety gate header: shows approval status + risk level */
function SafetyGateHeader({ data }: { data: Record<string, unknown> }) {
  const approved = data.approved as boolean;
  const riskLevel = (data.risk_level as string) ?? 'unknown';
  const requiresHuman = data.requires_human as boolean;
  const reason = data.reason as string;

  return (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-lg',
      approved ? 'bg-green-500/8 border border-green-500/20'
               : requiresHuman ? 'bg-amber-500/8 border border-amber-500/20'
               : 'bg-red-500/8 border border-red-500/20'
    )}>
      {/* Status icon */}
      <div className={cn(
        'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm',
        approved ? 'bg-green-500/15 text-green-600'
                 : requiresHuman ? 'bg-amber-500/15 text-amber-600'
                 : 'bg-red-500/15 text-red-600'
      )}>
        {approved ? '✓' : requiresHuman ? '👤' : '✗'}
      </div>

      {/* Status text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[11px] font-semibold', {
            'text-green-600 dark:text-green-400': approved,
            'text-amber-600 dark:text-amber-400': !approved && requiresHuman,
            'text-red-600 dark:text-red-400': !approved && !requiresHuman,
          })}>
            {approved ? 'Approved & Executed' : requiresHuman ? 'Requires Human Approval' : 'Denied by Safety Engine'}
          </span>
          <RiskLevelBadge level={riskLevel} />
        </div>
        {reason && (
          <div className="text-[10px] text-muted-foreground mt-0.5 break-words">{reason}</div>
        )}
        {requiresHuman && !approved && (
          <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
            ⚡ Action blocked — awaiting explicit operator confirmation
          </div>
        )}
      </div>
    </div>
  );
}

/** Dry-run banner */
function DryRunBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/25 text-yellow-700 dark:text-yellow-400">
      <span className="text-[10px]">🔬</span>
      <span className="text-[10px] font-semibold">DRY RUN — No changes were applied to the cluster</span>
    </div>
  );
}

/** Success execution summary */
function ExecutionSuccess({ data, label }: { data: Record<string, unknown>; label: string }) {
  const message = data.message as string;
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-green-500/8 border border-green-500/20">
      <span className="text-green-500 shrink-0">✓</span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-green-600 dark:text-green-400">{label}</div>
        {message && <div className="text-[9px] text-muted-foreground mt-0.5">{message}</div>}
      </div>
    </div>
  );
}

/** Execution result metadata chips */
function ExecMeta({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.filter(it => it.value !== undefined && it.value !== null && it.value !== '').map((it, i) => (
        <div key={i} className="flex items-center gap-1 px-2 py-0.5 rounded bg-muted/30 border border-border/40">
          <span className="text-[9px] text-muted-foreground">{it.label}</span>
          <span className="text-[10px] font-medium">{String(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Per-tool execution cards ──────────────────────────────────────────────────

function RestartPodCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label="Pod restart initiated" />
      )}
      <ExecMeta items={[
        { label: 'Pod', value: data.pod as string },
        { label: 'Namespace', value: data.namespace as string },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function ScaleDeploymentCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  const replicas = data.replicas;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label={`Deployment scaled to ${replicas} replicas`} />
      )}
      <ExecMeta items={[
        { label: 'Deployment', value: data.name as string },
        { label: 'Namespace', value: data.namespace as string },
        { label: 'Replicas', value: replicas },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function CordonNodeCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label="Node cordoned — marked unschedulable" />
      )}
      <ExecMeta items={[
        { label: 'Node', value: data.node as string },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function DrainNodeCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label="Node drained — all pods evicted" />
      )}
      <ExecMeta items={[
        { label: 'Node', value: data.node as string },
      ]} />
      {!approved && (
        <div className="px-2 py-1.5 rounded bg-amber-500/8 border border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-400">
          ⚠️ Node draining is a high-blast-radius operation. Review policy checks and obtain approval before proceeding.
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function ApplyResourcePatchCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  const patch = data.patch as Record<string, unknown> | undefined;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label="Patch applied successfully" />
      )}
      <ExecMeta items={[
        { label: 'Resource', value: data.resource as string },
      ]} />
      {isDryRun && patch && (
        <div className="space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Patch Preview</div>
          <pre className="text-[9px] leading-relaxed bg-muted/20 rounded p-2 overflow-auto max-h-24 text-muted-foreground">
            {JSON.stringify(patch, null, 2)}
          </pre>
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function DeleteResourceCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label="Resource deleted" />
      )}
      <ExecMeta items={[
        { label: 'Resource', value: data.resource as string },
      ]} />
      {!approved && (
        <div className="px-2 py-1.5 rounded bg-red-500/8 border border-red-500/20 text-[10px] text-red-700 dark:text-red-400">
          🚨 Resource deletion is irreversible. Safety engine requires explicit human confirmation.
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function RollbackDeploymentCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  const revision = data.revision;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label={revision ? `Rolled back to revision ${revision}` : 'Rolled back to previous revision'} />
      )}
      <ExecMeta items={[
        { label: 'Deployment', value: data.name as string },
        { label: 'Namespace', value: data.namespace as string },
        { label: 'Revision', value: revision !== undefined ? String(revision) : 'previous' },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function UpdateResourceLimitsCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  const patch = data.patch as Record<string, unknown> | undefined;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label="Resource limits updated" />
      )}
      <ExecMeta items={[
        { label: 'Resource', value: data.resource as string },
        { label: 'Container', value: data.container as string },
      ]} />
      {isDryRun && patch && (
        <div className="space-y-1">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Limits Patch Preview</div>
          <pre className="text-[9px] leading-relaxed bg-muted/20 rounded p-2 overflow-auto max-h-24 text-muted-foreground">
            {JSON.stringify(patch, null, 2)}
          </pre>
        </div>
      )}
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

function TriggerHPAScaleCard({ data }: { data: Record<string, unknown> }) {
  const isDryRun = data.dry_run as boolean;
  const approved = data.approved as boolean;
  const targetReplicas = data.target_replicas;
  return (
    <div className="space-y-2">
      {isDryRun && <DryRunBanner />}
      <SafetyGateHeader data={data} />
      {approved && !isDryRun && (
        <ExecutionSuccess data={data} label={`HPA scaled to ${targetReplicas} target replicas`} />
      )}
      <ExecMeta items={[
        { label: 'HPA', value: data.hpa as string },
        { label: 'Namespace', value: data.namespace as string },
        { label: 'Target Replicas', value: targetReplicas },
      ]} />
      <PolicyChecksList checks={(data.policy_checks as PolicyCheckRow[]) ?? []} />
    </div>
  );
}

/**
 * ExecutionResultCard — routes to specialized card by tool name.
 * Handles safety gate denied, requires_human, dry_run, and success states.
 */
function ExecutionResultCard({
  toolName,
  resultJson,
}: {
  toolName: string;
  resultJson: string;
}) {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(resultJson) as Record<string, unknown>;
  } catch {
    // not JSON — render raw
  }

  if (!parsed) {
    return (
      <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
        {resultJson}
      </pre>
    );
  }

  switch (toolName) {
    case 'restart_pod':           return <RestartPodCard data={parsed} />;
    case 'scale_deployment':      return <ScaleDeploymentCard data={parsed} />;
    case 'cordon_node':           return <CordonNodeCard data={parsed} />;
    case 'drain_node':            return <DrainNodeCard data={parsed} />;
    case 'apply_resource_patch':  return <ApplyResourcePatchCard data={parsed} />;
    case 'delete_resource':       return <DeleteResourceCard data={parsed} />;
    case 'rollback_deployment':   return <RollbackDeploymentCard data={parsed} />;
    case 'update_resource_limits': return <UpdateResourceLimitsCard data={parsed} />;
    case 'trigger_hpa_scale':     return <TriggerHPAScaleCard data={parsed} />;
    default:
      return (
        <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
  }
}

// ─── ToolEventBubble ──────────────────────────────────────────────────────────

interface ToolEventBubbleProps {
  event: ToolEvent;
}

function ToolEventBubble({ event }: ToolEventBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const isCalling = event.phase === 'calling';
  const isError = event.phase === 'error';
  const isResult = event.phase === 'result';

  const cat = getToolCategory(event.tool_name);
  const CategoryIcon = cat.icon;

  // Try to pretty-print JSON result
  let prettyResult = event.result ?? '';
  let isJson = false;
  if (isResult && prettyResult) {
    try {
      const parsed = JSON.parse(prettyResult);
      prettyResult = JSON.stringify(parsed, null, 2);
      isJson = true;
    } catch {
      // not JSON, leave as-is
    }
  }

  const hasArgs = isCalling && event.args && Object.keys(event.args).length > 0;
  const resultTruncated = prettyResult.length > 200;
  const displayResult = expanded ? prettyResult : prettyResult.slice(0, 200) + (resultTruncated ? '…' : '');

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div
        className={cn(
          'max-w-[92%] rounded-xl border text-xs font-mono overflow-hidden',
          cat.bgColor,
          cat.borderColor,
          isError && 'bg-destructive/8 border-destructive/25',
        )}
      >
        {/* Header row */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-3 py-2',
            (isResult || isError) && resultTruncated && 'cursor-pointer hover:opacity-80'
          )}
          onClick={() => (isResult || isError) && setExpanded((e) => !e)}
        >
          {/* Phase indicator */}
          {isCalling && <Loader2 className={cn('h-3 w-3 animate-spin shrink-0', cat.color)} />}
          {isResult && <CheckCircle className="h-3 w-3 shrink-0 text-green-500" />}
          {isError && <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />}

          <CategoryIcon className={cn('h-3 w-3 shrink-0', cat.color)} />

          {/* Tool name badge */}
          <span className={cn('font-semibold truncate max-w-[180px]', cat.color)}>
            {humanizeToolName(event.tool_name)}
          </span>

          {/* Status label */}
          <span className="text-muted-foreground ml-auto shrink-0">
            {isCalling && 'running…'}
            {isResult && 'done'}
            {isError && 'failed'}
          </span>

          {/* Expand/collapse toggle */}
          {(isResult || isError) && (prettyResult.length > 0) && (
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground ml-1"
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
            >
              {expanded
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Args chips (only when calling) */}
        {hasArgs && (
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {Object.entries(event.args!).map(([k, v]) => (
              <span
                key={k}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] border',
                  'bg-background/50',
                  cat.borderColor,
                  cat.color,
                )}
              >
                <span className="opacity-60">{k}=</span>
                <span>{JSON.stringify(v)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Result / error body */}
        {isResult && prettyResult && (
          <div className="px-3 pb-2">
            {/* Deep-analysis tools get a specialized rich card; others get raw JSON */}
            {DEEP_ANALYSIS_TOOLS.has(event.tool_name) ? (
              <AnalysisResultCard toolName={event.tool_name} resultJson={event.result ?? ''} />
            ) : EXECUTION_TOOLS.has(event.tool_name) ? (
              <ExecutionResultCard toolName={event.tool_name} resultJson={event.result ?? ''} />
            ) : (
              <>
                <pre
                  className={cn(
                    'text-[10px] leading-relaxed break-all whitespace-pre-wrap',
                    'text-muted-foreground',
                    !expanded && 'line-clamp-3',
                    isJson && 'language-json',
                  )}
                >
                  {displayResult}
                </pre>
                {resultTruncated && (
                  <button
                    onClick={() => setExpanded((x) => !x)}
                    className={cn('text-[10px] mt-1', cat.color, 'hover:underline')}
                  >
                    {expanded ? 'Show less' : `Show all (${prettyResult.length} chars)`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {isError && event.error && (
          <div className="px-3 pb-2 text-destructive break-words">
            {event.error}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── AIAssistant ──────────────────────────────────────────────────────────────

type AITab = 'chat' | 'investigate' | 'safety' | 'backend' | 'memory' | 'analytics' | 'cost' | 'security' | 'persistence' | 'budget';

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AITab>('chat');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const getContext = useRouteContext();

  // Build WebSocket URL from context
  const wsUrl = buildChatWSUrl(getContext());

  const {
    messages,
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendUserMessage,
    clearMessages,
  } = useWebSocket({
    url: wsUrl,
    autoConnect: false,
  });

  // Connect when chat is opened, disconnect when closed
  useEffect(() => {
    if (isOpen) {
      connect();
    } else {
      disconnect();
    }
  }, [isOpen, connect, disconnect]);

  // Keyboard shortcut: Cmd+Shift+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const isLoading =
    messages.length > 0 &&
    messages[messages.length - 1].role === 'user' &&
    (isConnecting || isConnected);

  const handleSend = useCallback(() => {
    if (!input.trim() || !isConnected) return;
    sendUserMessage(input.trim(), getContext());
    setInput('');
  }, [input, isConnected, sendUserMessage, getContext]);

  const handleSuggestedQuery = useCallback((query: string) => {
    setInput(query);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return (
    <>
      {/* Floating trigger button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <Button
              onClick={() => setIsOpen(true)}
              size="lg"
              className="h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Bot className="h-6 w-6" />
            </Button>
            <Badge
              variant="secondary"
              className="absolute -top-1 -right-1 text-[10px] px-1.5"
            >
              ⌘⇧P
            </Badge>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={cn(
              'fixed z-50 flex flex-col bg-card border border-border rounded-2xl shadow-xl overflow-hidden',
              isExpanded
                ? 'inset-6'
                : 'bottom-6 right-6 w-[420px] h-[600px] max-h-[80vh]'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Kubilitics AI</h3>
                  <div className="flex items-center gap-1.5">
                    {isConnecting ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
                        <p className="text-[10px] text-muted-foreground">Connecting...</p>
                      </>
                    ) : isConnected ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        <p className="text-[10px] text-muted-foreground">Connected</p>
                      </>
                    ) : (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        <p className="text-[10px] text-muted-foreground">Disconnected</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Tab switcher */}
              <div className="flex items-center gap-0.5 bg-muted/60 rounded-lg p-0.5 mx-2">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'chat'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Bot className="h-3 w-3" />
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab('investigate')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'investigate'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Brain className="h-3 w-3" />
                  Investigate
                </button>
                <button
                  onClick={() => setActiveTab('safety')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'safety'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Shield className="h-3 w-3" />
                  Safety
                </button>
                <button
                  onClick={() => setActiveTab('backend')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'backend'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Server className="h-3 w-3" />
                  Backend
                </button>
                <button
                  onClick={() => setActiveTab('memory')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'memory'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Database className="h-3 w-3" />
                  Memory
                </button>
                <button
                  onClick={() => setActiveTab('analytics')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'analytics'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Activity className="h-3 w-3" />
                  Analytics
                </button>
                <button
                  onClick={() => setActiveTab('cost')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'cost'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <DollarSign className="h-3 w-3" />
                  Cost
                </button>
                <button
                  onClick={() => setActiveTab('security')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'security'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Shield className="h-3 w-3" />
                  SecOps
                </button>
                <button
                  onClick={() => setActiveTab('persistence')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'persistence'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Database className="h-3 w-3" />
                  DB
                </button>
                <button
                  onClick={() => setActiveTab('budget')}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                    activeTab === 'budget'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Zap className="h-3 w-3" />
                  Budget
                </button>
              </div>

              <div className="flex items-center gap-1">
                {/* Clear messages */}
                {messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={clearMessages}
                    title="Clear chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {/* Reconnect when disconnected */}
                {!isConnected && !isConnecting && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={connect}
                    title="Reconnect"
                  >
                    <Wifi className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Investigation tab */}
            {activeTab === 'investigate' && (
              <div className="flex-1 overflow-hidden">
                <InvestigationPanel />
              </div>
            )}

            {/* Safety tab */}
            {activeTab === 'safety' && (
              <div className="flex-1 overflow-hidden">
                <SafetyPanel />
              </div>
            )}

            {/* Backend tab */}
            {activeTab === 'backend' && (
              <div className="flex-1 overflow-hidden">
                <BackendConnectionPanel />
              </div>
            )}

            {/* Memory tab */}
            {activeTab === 'memory' && (
              <div className="flex-1 overflow-hidden">
                <MemoryPanel />
              </div>
            )}

            {/* Analytics tab */}
            {activeTab === 'analytics' && (
              <div className="flex-1 overflow-y-auto p-4">
                <AnalyticsPanel />
              </div>
            )}

            {/* Cost Intelligence tab */}
            {activeTab === 'cost' && (
              <div className="flex-1 overflow-y-auto p-4">
                <CostPanel />
              </div>
            )}

            {/* Security Analysis tab (A-CORE-012) */}
            {activeTab === 'security' && (
              <div className="flex-1 overflow-y-auto p-4">
                <SecurityPanel />
              </div>
            )}

            {/* Persistence Layer tab (A-CORE-013) */}
            {activeTab === 'persistence' && (
              <div className="flex-1 overflow-y-auto p-4">
                <PersistencePanel />
              </div>
            )}

            {/* Token Budget tab (A-CORE-014) */}
            {activeTab === 'budget' && (
              <div className="flex-1 overflow-y-auto p-4">
                <BudgetPanel />
              </div>
            )}

            {/* Messages */}
            {activeTab === 'chat' && (
            <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="text-center py-8">
                    <Bot className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <h4 className="font-medium text-sm mb-1">How can I help?</h4>
                    <p className="text-xs text-muted-foreground">
                      Ask me anything about your Kubernetes cluster
                    </p>
                    {!isConnected && !isConnecting && (
                      <p className="text-xs text-destructive mt-2">
                        Not connected — configure your AI provider in Settings
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Suggested queries</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedQueries.map((query) => (
                        <button
                          key={query}
                          onClick={() => handleSuggestedQuery(query)}
                          className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {query}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, idx) => {
                    // Tool event messages rendered as inline progress indicators.
                    if (message.role === 'tool_event' && message.toolEvent) {
                      return (
                        <ToolEventBubble
                          key={`tool-${idx}`}
                          event={message.toolEvent}
                        />
                      );
                    }

                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          'flex',
                          message.role === 'user' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        <div
                          className={cn(
                            'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                            message.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-br-md'
                              : message.role === 'system'
                              ? 'bg-destructive/10 text-destructive rounded-bl-md text-xs'
                              : 'bg-muted rounded-bl-md'
                          )}
                        >
                          <div className="whitespace-pre-wrap">{message.content}</div>

                          {message.role === 'assistant' && (
                            <button
                              onClick={() => handleCopy(String(idx), message.content)}
                              className="mt-2 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                            >
                              {copiedId === String(idx) ? (
                                <>
                                  <CheckCircle className="h-3 w-3" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Copy
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}

                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
                      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Thinking...
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </ScrollArea>
            )}

            {/* Input — only shown in chat tab */}
            {activeTab === 'chat' && (
            <div className="p-4 border-t border-border bg-muted/20">
              {!isConnected && !isConnecting && (
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                  <WifiOff className="h-3.5 w-3.5 text-destructive" />
                  <span>AI service offline. Check Settings → AI Configuration.</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={
                    isConnected
                      ? 'Ask anything about your cluster...'
                      : 'Connect AI service first...'
                  }
                  className="flex-1 bg-background border border-input rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  disabled={!isConnected}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || !isConnected}
                  size="icon"
                  className="h-10 w-10 rounded-xl"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                Press ⌘⇧P to toggle • ESC to close
              </p>
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
