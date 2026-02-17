/**
 * AnalyticsOverview — B-INT-009 + B-INT-010 fix: Wire to real multi-source APIs
 *
 * All endpoints live on the Kubilitics AI backend (port 8081, AI_BASE_URL):
 *   GET  /health                              → API status (healthy / not_ready)
 *   GET  /info                                → llm_provider, analytics_enabled
 *   GET  /api/v1/security/posture             → security score/grade, critical issues
 *   GET  /api/v1/security/compliance          → CIS compliance score
 *   GET  /api/v1/analytics/anomalies          → 24h anomaly count
 *   GET  /api/v1/analytics/recommendations    → cross-domain insights
 *   GET  /api/v1/analytics/ml/models          → active ML models
 *   GET  /api/v1/cost/overview                → monthly cost, cost trend
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Shield,
  Brain,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  Sparkles,
  Minus
} from 'lucide-react';
import {
  getAIHealth,
  getAIInfo,
  getAnomalies,
  getRecommendations,
  getMLModels,
  AI_BASE_URL,
  type AnalyticsRecommendation,
  type AIServerInfo,
} from '@/services/aiService';

// ─── Config ──────────────────────────────────────────────────────────────────
// All endpoints (including /api/v1/cost/*) live on the AI backend. One base URL.
const AI_BASE = AI_BASE_URL;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SecurityPosture {
  overall_score: number;
  security_grade: string;
  critical_issues: number;
  high_issues: number;
  compliance_score: number;
}

interface CostOverview {
  total_cost_month: number;
  total_cost_day: number;
  savings_opportunities: number;
  provider: string;
}

// Synthesized view for the health cards
interface SystemHealth {
  security_score: number;
  security_grade: string;
  anomalies_24h: number;
  monthly_cost: number;
  cost_trend: 'up' | 'down' | 'stable';
  compliance_score: number;
  critical_issues: number;
  ml_models_active: number;
  ai_provider: string;
  analytics_enabled: boolean;
  ai_reachable: boolean;
  backend_reachable: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AnalyticsOverview() {
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [insights, setInsights] = useState<AnalyticsRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ─── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setIsLoading(true);

    // Fan out all requests concurrently
    const [
      healthResult,
      infoResult,
      securityResult,
      complianceResult,
      anomaliesResult,
      recommendationsResult,
      costResult,
      mlModelsResult,
    ] = await Promise.allSettled([
      getAIHealth(),
      getAIInfo(),
      fetch(`${AI_BASE}/api/v1/security/posture`).then(r => r.ok ? r.json() : null),
      fetch(`${AI_BASE}/api/v1/security/compliance`).then(r => r.ok ? r.json() : null),
      getAnomalies(),
      getRecommendations(),
      fetch(`${AI_BASE}/api/v1/cost/overview`).then(r => r.ok ? r.json() : null),
      getMLModels(),
    ]);

    const aiHealth = healthResult.status === 'fulfilled' ? healthResult.value : null;
    const aiInfo: AIServerInfo | null = infoResult.status === 'fulfilled' ? infoResult.value : null;
    const security: SecurityPosture | null = securityResult.status === 'fulfilled' ? securityResult.value : null;
    const compliance: { compliance_percentage?: number; score?: number } | null = complianceResult.status === 'fulfilled' ? complianceResult.value : null;
    const anomalies = anomaliesResult.status === 'fulfilled' ? anomaliesResult.value : [];
    const recs = recommendationsResult.status === 'fulfilled' ? recommendationsResult.value : [];
    const cost: CostOverview | null = costResult.status === 'fulfilled' ? costResult.value : null;
    const mlModels = mlModelsResult.status === 'fulfilled' ? mlModelsResult.value : null;

    // Derive compliance score from either field
    const complianceScore = compliance?.compliance_percentage
      ?? compliance?.score
      ?? security?.compliance_score
      ?? 0;

    // Calculate cost trend from savings opportunities vs monthly cost
    let costTrend: 'up' | 'down' | 'stable' = 'stable';
    if (cost) {
      const savings = cost.savings_opportunities ?? 0;
      const monthly = cost.total_cost_month ?? 0;
      if (monthly > 0 && savings / monthly > 0.1) costTrend = 'up'; // >10% savings available = costs trending high
      else costTrend = 'stable';
    }

    setSystemHealth({
      security_score: security?.overall_score ?? 0,
      security_grade: security?.security_grade ?? '—',
      anomalies_24h: anomalies.length,
      monthly_cost: cost?.total_cost_month ?? 0,
      cost_trend: costTrend,
      compliance_score: complianceScore,
      critical_issues: security?.critical_issues ?? 0,
      ml_models_active: mlModels?.models?.length ?? 0,
      ai_provider: aiInfo?.llm_provider ?? 'none',
      analytics_enabled: aiInfo?.analytics_enabled ?? false,
      ai_reachable: aiHealth?.status === 'healthy',
      backend_reachable: cost != null,
    });

    setInsights(recs);
    setLastUpdated(new Date());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ─── Display helpers ───────────────────────────────────────────────────────

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'text-green-600';
      case 'B': return 'text-blue-600';
      case 'C': return 'text-yellow-600';
      case 'D': return 'text-orange-600';
      case 'F': return 'text-red-600';
      default:  return 'text-gray-400';
    }
  };

  const getImpactBadge = (impact: string) => {
    const variants: Record<string, 'destructive' | 'default' | 'secondary'> = {
      high:   'destructive',
      medium: 'default',
      low:    'secondary',
    };
    return <Badge variant={variants[impact] ?? 'default'}>{impact.toUpperCase()}</Badge>;
  };

  const getCategoryIcon = (type: string) => {
    if (type.toLowerCase().includes('secur') || type.toLowerCase().includes('vuln'))
      return <Shield className="h-4 w-4 text-blue-600" />;
    if (type.toLowerCase().includes('cost') || type.toLowerCase().includes('saving'))
      return <DollarSign className="h-4 w-4 text-green-600" />;
    return <Brain className="h-4 w-4 text-purple-600" />;
  };

  const getInsightLink = (rec: AnalyticsRecommendation) => {
    if (rec.type?.toLowerCase().includes('secur') || rec.type?.toLowerCase().includes('vuln'))
      return '/security';
    if (rec.type?.toLowerCase().includes('cost') || rec.type?.toLowerCase().includes('saving'))
      return '/cost';
    return '/ml-analytics';
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="animate-spin rounded-full h-12 w-12 text-blue-600 mx-auto mb-4" />
            <p className="text-muted-foreground">Loading analytics…</p>
          </div>
        </div>
      </div>
    );
  }

  const health = systemHealth!;

  return (
    <div className="container mx-auto p-6 space-y-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics Overview</h1>
          <p className="text-muted-foreground mt-1">
            Unified insights from Security, ML Analytics, and Cost Intelligence
            {lastUpdated && (
              <span className="ml-2 text-xs text-gray-400">
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* ── System Health Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Security */}
        <Link to="/security">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Security</CardTitle>
                <Shield className="h-5 w-5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <div className={`text-4xl font-bold ${getGradeColor(health.security_grade)}`}>
                  {health.security_grade}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold">{health.security_score}</p>
                  <p className="text-xs text-muted-foreground">out of 100</p>
                </div>
              </div>
              {health.critical_issues > 0 ? (
                <div className="flex items-center gap-1 text-red-600 text-xs">
                  <XCircle className="h-3 w-3" />
                  {health.critical_issues} critical issue{health.critical_issues !== 1 ? 's' : ''}
                </div>
              ) : (
                <div className="flex items-center gap-1 text-green-600 text-xs">
                  <CheckCircle2 className="h-3 w-3" />
                  {health.ai_reachable ? 'No critical issues' : 'Connect AI backend for scan'}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* ML Analytics */}
        <Link to="/ml-analytics">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">ML Analytics</CardTitle>
                <Brain className="h-5 w-5 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-purple-600 mb-2">
                {health.anomalies_24h}
              </div>
              <p className="text-xs text-muted-foreground">Anomalies detected (24h)</p>
              {health.anomalies_24h > 10 ? (
                <div className="flex items-center gap-1 text-orange-600 text-xs mt-2">
                  <AlertTriangle className="h-3 w-3" />
                  Above normal threshold
                </div>
              ) : health.ai_reachable ? (
                <div className="flex items-center gap-1 text-green-600 text-xs mt-2">
                  <CheckCircle2 className="h-3 w-3" />
                  Within normal range
                </div>
              ) : (
                <div className="flex items-center gap-1 text-muted-foreground text-xs mt-2">
                  <Minus className="h-3 w-3" />
                  Connect AI backend
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        {/* Cost */}
        <Link to="/cost">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Cost (Monthly)</CardTitle>
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600 mb-2">
                {health.monthly_cost > 0
                  ? `$${health.monthly_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
              <div className={`flex items-center gap-1 text-xs ${
                health.cost_trend === 'up' ? 'text-red-600' :
                health.cost_trend === 'down' ? 'text-green-600' : 'text-gray-500'
              }`}>
                {health.cost_trend === 'up' ? (
                  <><TrendingUp className="h-3 w-3" /> Savings opportunities available</>
                ) : health.cost_trend === 'down' ? (
                  <><TrendingDown className="h-3 w-3" /> Costs trending down</>
                ) : (
                  <>{health.backend_reachable ? 'Costs stable' : 'Connect backend for costs'}</>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Compliance */}
        <Link to="/security">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Compliance</CardTitle>
                <CheckCircle2 className="h-5 w-5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600 mb-2">
                {health.compliance_score > 0 ? `${health.compliance_score.toFixed(1)}%` : '—'}
              </div>
              <p className="text-xs text-muted-foreground">CIS Kubernetes</p>
              {health.compliance_score > 0 ? (
                health.compliance_score < 80 ? (
                  <div className="flex items-center gap-1 text-orange-600 text-xs mt-2">
                    <AlertTriangle className="h-3 w-3" />
                    Needs improvement
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-green-600 text-xs mt-2">
                    <CheckCircle2 className="h-3 w-3" />
                    Good standing
                  </div>
                )
              ) : (
                <div className="flex items-center gap-1 text-muted-foreground text-xs mt-2">
                  <Minus className="h-3 w-3" />
                  Run compliance check
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── Cross-Module Insights ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI-Powered Insights &amp; Recommendations
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Cross-domain insights combining security, performance, and cost data from the AI engine
          </p>
        </CardHeader>
        <CardContent>
          {insights.length > 0 ? (
            <div className="space-y-3">
              {insights.map((rec, idx) => (
                <div key={idx} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(rec.type)}
                      <span className="text-xs font-semibold uppercase text-muted-foreground">
                        {rec.type.replace(/_/g, ' ')}
                      </span>
                      {getImpactBadge(rec.impact)}
                    </div>
                    {rec.potential_savings != null && rec.potential_savings > 0 && (
                      <span className="text-sm font-bold text-green-600">
                        ${rec.potential_savings}/mo saved
                      </span>
                    )}
                  </div>
                  <h4 className="font-semibold mb-1">{rec.title}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{rec.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Resource: <span className="font-medium">{rec.resource}</span>
                      {rec.namespace && <> / <span className="font-medium">{rec.namespace}</span></>}
                    </span>
                    <Link to={getInsightLink(rec)}>
                      <Button variant="outline" size="sm">
                        Investigate
                        <ArrowRight className="h-3 w-3 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {health.ai_reachable ? (
                <>
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500 opacity-70" />
                  <p>No recommendations — your cluster looks healthy!</p>
                </>
              ) : (
                <>
                  <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Connect the AI backend to receive intelligent insights.</p>
                  <p className="text-xs mt-1">Start kubilitics-ai at <code>{import.meta.env.VITE_AI_BACKEND_URL || 'http://localhost:8081'}</code></p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/security">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-600" />
                Security Dashboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Vulnerability scans, security issues, and compliance reports
              </p>
              <Button variant="outline" size="sm" className="w-full">
                Go to Security <ArrowRight className="h-3 w-3 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link to="/ml-analytics">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-600" />
                ML Analytics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Anomaly detection (Isolation Forest), ARIMA forecasting, model explainability
              </p>
              <Button variant="outline" size="sm" className="w-full">
                Go to ML Analytics <ArrowRight className="h-3 w-3 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link to="/cost">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                Cost Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Cost optimization, 6-month forecasting, and multi-cloud pricing
              </p>
              <Button variant="outline" size="sm" className="w-full">
                Go to Cost Dashboard <ArrowRight className="h-3 w-3 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── System Status ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* AI backend */}
            <div className={`flex items-center justify-between p-3 rounded ${
              health.ai_reachable ? 'bg-green-50 dark:bg-green-900/20' : 'bg-yellow-50 dark:bg-yellow-900/20'
            }`}>
              <div className="flex items-center gap-2">
                {health.ai_reachable
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                  : <AlertTriangle className="h-5 w-5 text-yellow-600" />}
                <div>
                  <p className="text-sm font-semibold">AI Backend</p>
                  <p className="text-xs text-muted-foreground">
                    {health.ai_reachable
                      ? `Provider: ${health.ai_provider === 'none' ? 'heuristic' : health.ai_provider}`
                      : 'Not reachable'}
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className={health.ai_reachable ? 'bg-green-600 text-white' : 'bg-yellow-500 text-white'}>
                {health.ai_reachable ? 'Online' : 'Offline'}
              </Badge>
            </div>

            {/* ML Models */}
            <div className={`flex items-center justify-between p-3 rounded ${
              health.ml_models_active > 0 ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-gray-50 dark:bg-gray-800'
            }`}>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-semibold">ML Models</p>
                  <p className="text-xs text-muted-foreground">
                    {health.ml_models_active > 0
                      ? `${health.ml_models_active} model${health.ml_models_active !== 1 ? 's' : ''} available`
                      : 'No models loaded'}
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className={health.ml_models_active > 0 ? 'bg-blue-600 text-white' : ''}>
                {health.ml_models_active > 0 ? 'Active' : 'Idle'}
              </Badge>
            </div>

            {/* Backend / Data Collection */}
            <div className={`flex items-center justify-between p-3 rounded ${
              health.backend_reachable ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'
            }`}>
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-600" />
                <div>
                  <p className="text-sm font-semibold">Data Collection</p>
                  <p className="text-xs text-muted-foreground">
                    {health.backend_reachable ? 'Live cluster metrics' : 'Backend not connected'}
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className={health.backend_reachable ? 'bg-purple-600 text-white' : ''}>
                {health.backend_reachable ? 'Running' : 'Paused'}
              </Badge>
            </div>

          </div>
        </CardContent>
      </Card>
    </div>
  );
}
