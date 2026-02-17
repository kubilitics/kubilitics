import { useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Shield,
  Zap,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useResourceInsights, ResourceInsight, ResourceRecommendation } from '@/hooks/useResourceInsights';

interface ResourceInsightsPanelProps {
  resourceType: string;
  resourceName: string;
  namespace?: string;
  metrics?: {
    cpu?: Array<{ timestamp: string; value: number }>;
    memory?: Array<{ timestamp: string; value: number }>;
    network?: Array<{ timestamp: string; value: number }>;
  };
  config?: {
    cpuLimit?: number;
    memoryLimit?: number;
    replicas?: number;
  };
  status?: {
    phase?: string;
    restarts?: number;
    age?: number;
  };
}

export function ResourceInsightsPanel({
  resourceType,
  resourceName,
  namespace,
  metrics,
  config,
  status
}: ResourceInsightsPanelProps) {
  const [expandedSections, setExpandedSections] = useState({
    health: true,
    insights: true,
    recommendations: true,
    predictions: false
  });

  const {
    insights,
    recommendations,
    healthAssessment,
    predictions,
    isLoading,
    refresh
  } = useResourceInsights({
    resourceType,
    resourceName,
    namespace,
    metrics,
    config,
    status,
    enabled: true
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'text-green-700 bg-green-100';
    if (score >= 60) return 'text-yellow-700 bg-yellow-100';
    if (score >= 30) return 'text-orange-700 bg-orange-100';
    return 'text-red-700 bg-red-100';
  };

  const getHealthIcon = (score: number) => {
    if (score >= 80) return <Activity className="h-5 w-5 text-green-600" />;
    if (score >= 60) return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
    return <AlertTriangle className="h-5 w-5 text-red-600" />;
  };

  const getInsightIcon = (category: ResourceInsight['category']) => {
    switch (category) {
      case 'health':
        return <Activity className="h-4 w-4" />;
      case 'performance':
        return <TrendingUp className="h-4 w-4" />;
      case 'cost':
        return <DollarSign className="h-4 w-4" />;
      case 'security':
        return <Shield className="h-4 w-4" />;
      case 'reliability':
        return <Zap className="h-4 w-4" />;
    }
  };

  const getInsightColor = (severity: ResourceInsight['severity']) => {
    switch (severity) {
      case 'critical':
        return 'text-red-700 bg-red-50 border-red-200';
      case 'warning':
        return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      case 'info':
        return 'text-blue-700 bg-blue-50 border-blue-200';
    }
  };

  const getRecommendationIcon = (type: ResourceRecommendation['type']) => {
    switch (type) {
      case 'scale_up':
        return <TrendingUp className="h-4 w-4" />;
      case 'scale_down':
        return <TrendingDown className="h-4 w-4" />;
      case 'investigate':
        return <AlertTriangle className="h-4 w-4" />;
      case 'optimize':
        return <Zap className="h-4 w-4" />;
      case 'security':
        return <Shield className="h-4 w-4" />;
      case 'cost':
        return <DollarSign className="h-4 w-4" />;
    }
  };

  const getRecommendationColor = (priority: ResourceRecommendation['priority']) => {
    switch (priority) {
      case 'critical':
        return 'text-red-700 bg-red-50';
      case 'high':
        return 'text-orange-700 bg-orange-50';
      case 'medium':
        return 'text-yellow-700 bg-yellow-50';
      case 'low':
        return 'text-blue-700 bg-blue-50';
    }
  };

  return (
    <Card className="h-full border-none glass-panel">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cosmic-purple to-primary" />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="w-4 h-4 text-cosmic-purple fill-current" />
            <span className="text-gradient font-bold">AI Insights</span>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
            className="h-7 w-7 p-0"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 max-h-[calc(100%-4rem)] overflow-y-auto">
        {/* Health Assessment */}
        <div className="space-y-2">
          <button
            onClick={() => toggleSection('health')}
            className="flex items-center justify-between w-full text-sm font-semibold"
          >
            <span>Health Assessment</span>
            {expandedSections.health ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {expandedSections.health && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getHealthIcon(healthAssessment.score)}
                  <span className={`text-sm font-medium px-2 py-1 rounded ${getHealthColor(healthAssessment.score)}`}>
                    {healthAssessment.score}% Healthy
                  </span>
                </div>
                <Badge variant={healthAssessment.status === 'healthy' ? 'default' : 'destructive'}>
                  {healthAssessment.status.toUpperCase()}
                </Badge>
              </div>
              <Progress value={healthAssessment.score} className="h-2" />
              <p className="text-xs text-muted-foreground">{healthAssessment.summary}</p>
            </div>
          )}
        </div>

        {/* Insights */}
        {insights.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => toggleSection('insights')}
              className="flex items-center justify-between w-full text-sm font-semibold"
            >
              <span>Active Insights ({insights.length})</span>
              {expandedSections.insights ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {expandedSections.insights && (
              <div className="space-y-2">
                {insights.map((insight, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border ${getInsightColor(insight.severity)}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{getInsightIcon(insight.category)}</div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold">{insight.title}</h4>
                        <p className="text-xs mt-1">{insight.message}</p>
                        {insight.details && (
                          <p className="text-xs mt-1 opacity-75">{insight.details}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => toggleSection('recommendations')}
              className="flex items-center justify-between w-full text-sm font-semibold"
            >
              <span>Recommendations ({recommendations.length})</span>
              {expandedSections.recommendations ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {expandedSections.recommendations && (
              <div className="space-y-2">
                {recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg ${getRecommendationColor(rec.priority)}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">{getRecommendationIcon(rec.type)}</div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold">{rec.title}</h4>
                          <Badge variant="outline" className="text-xs">
                            {rec.priority}
                          </Badge>
                        </div>
                        <p className="text-xs">{rec.description}</p>
                        {rec.action && (
                          <div className="mt-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                              {rec.action} <ArrowRight className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                        {rec.impact && (
                          <p className="text-xs mt-1 opacity-75">
                            <strong>Impact:</strong> {rec.impact}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Predictions */}
        {(predictions.cpuTrend || predictions.memoryTrend || predictions.timeToCapacity) && (
          <div className="space-y-2">
            <button
              onClick={() => toggleSection('predictions')}
              className="flex items-center justify-between w-full text-sm font-semibold"
            >
              <span>Predictions</span>
              {expandedSections.predictions ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {expandedSections.predictions && (
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900">
                <div className="space-y-2 text-xs">
                  {predictions.cpuTrend && (
                    <div className="flex items-center justify-between">
                      <span>CPU Trend:</span>
                      <Badge variant="outline" className="text-xs">
                        {predictions.cpuTrend}
                      </Badge>
                    </div>
                  )}
                  {predictions.memoryTrend && (
                    <div className="flex items-center justify-between">
                      <span>Memory Trend:</span>
                      <Badge variant="outline" className="text-xs">
                        {predictions.memoryTrend}
                      </Badge>
                    </div>
                  )}
                  {predictions.timeToCapacity && (
                    <div className="flex items-center justify-between">
                      <span>Time to Capacity:</span>
                      <Badge variant="outline" className="text-xs">
                        {predictions.timeToCapacity}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {insights.length === 0 && recommendations.length === 0 && !isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No issues detected</p>
            <p className="text-xs">Resource is operating normally</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
