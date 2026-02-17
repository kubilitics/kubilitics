import { useEffect, useState } from 'react';
import { useAnomalyDetection, DataPoint } from './useAnomalyDetection';
import { useTrendAnalysis } from './useTrendAnalysis';

export interface ResourceRecommendation {
  type: 'scale_up' | 'scale_down' | 'investigate' | 'optimize' | 'security' | 'cost';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action?: string;
  impact?: string;
}

export interface ResourceInsight {
  category: 'health' | 'performance' | 'cost' | 'security' | 'reliability';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  details?: string;
  timestamp: Date;
}

export interface UseResourceInsightsOptions {
  resourceType: string;
  resourceName: string;
  namespace?: string;
  metrics?: {
    cpu?: DataPoint[];
    memory?: DataPoint[];
    network?: DataPoint[];
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
  enabled?: boolean;
}

export interface UseResourceInsightsResult {
  insights: ResourceInsight[];
  recommendations: ResourceRecommendation[];
  healthAssessment: {
    score: number;
    status: 'healthy' | 'warning' | 'critical' | 'unknown';
    summary: string;
  };
  predictions: {
    cpuTrend?: string;
    memoryTrend?: string;
    timeToCapacity?: string;
  };
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// Generate insights based on metrics and status
function generateInsights(options: UseResourceInsightsOptions): ResourceInsight[] {
  const insights: ResourceInsight[] = [];
  const { metrics, config, status, resourceType } = options;

  // CPU insights
  if (metrics?.cpu && metrics.cpu.length > 0) {
    const latestCpu = metrics.cpu[metrics.cpu.length - 1].value;
    const avgCpu = metrics.cpu.reduce((sum, d) => sum + d.value, 0) / metrics.cpu.length;

    if (config?.cpuLimit && latestCpu > config.cpuLimit * 0.9) {
      insights.push({
        category: 'performance',
        severity: 'critical',
        title: 'CPU Near Limit',
        message: `CPU usage (${latestCpu.toFixed(1)}%) is approaching limit (${config.cpuLimit}%)`,
        details: 'Consider increasing CPU limits to prevent throttling',
        timestamp: new Date()
      });
    } else if (avgCpu < 20) {
      insights.push({
        category: 'cost',
        severity: 'info',
        title: 'CPU Underutilized',
        message: `Average CPU usage is only ${avgCpu.toFixed(1)}%`,
        details: 'Consider reducing CPU requests to optimize costs',
        timestamp: new Date()
      });
    }
  }

  // Memory insights
  if (metrics?.memory && metrics.memory.length > 0) {
    const latestMemory = metrics.memory[metrics.memory.length - 1].value;
    const avgMemory = metrics.memory.reduce((sum, d) => sum + d.value, 0) / metrics.memory.length;

    if (config?.memoryLimit && latestMemory > config.memoryLimit * 0.85) {
      insights.push({
        category: 'performance',
        severity: 'warning',
        title: 'Memory Usage High',
        message: `Memory usage (${latestMemory.toFixed(1)}%) is approaching limit (${config.memoryLimit}%)`,
        details: 'Memory pressure may cause OOMKills',
        timestamp: new Date()
      });
    } else if (avgMemory < 20) {
      insights.push({
        category: 'cost',
        severity: 'info',
        title: 'Memory Overprovisioned',
        message: `Average memory usage is only ${avgMemory.toFixed(1)}%`,
        details: 'Consider reducing memory requests',
        timestamp: new Date()
      });
    }
  }

  // Restart insights
  if (status?.restarts && status.restarts > 5) {
    insights.push({
      category: 'reliability',
      severity: status.restarts > 10 ? 'critical' : 'warning',
      title: 'Frequent Restarts Detected',
      message: `${resourceType} has restarted ${status.restarts} times`,
      details: 'Investigate logs for crash causes. Common issues: OOMKills, liveness probe failures, application errors',
      timestamp: new Date()
    });
  }

  // Age insights (for pods)
  if (resourceType.toLowerCase() === 'pod' && status?.age) {
    const ageInDays = status.age / (1000 * 60 * 60 * 24);
    if (ageInDays > 30) {
      insights.push({
        category: 'reliability',
        severity: 'info',
        title: 'Long-Running Pod',
        message: `Pod has been running for ${Math.floor(ageInDays)} days`,
        details: 'Consider periodic restarts to pick up latest images and reduce drift',
        timestamp: new Date()
      });
    }
  }

  return insights;
}

// Generate recommendations
function generateRecommendations(
  options: UseResourceInsightsOptions,
  insights: ResourceInsight[]
): ResourceRecommendation[] {
  const recommendations: ResourceRecommendation[] = [];
  const { metrics, config, status, resourceType } = options;

  // CPU-based recommendations
  if (metrics?.cpu && metrics.cpu.length > 0) {
    const avgCpu = metrics.cpu.reduce((sum, d) => sum + d.value, 0) / metrics.cpu.length;
    const maxCpu = Math.max(...metrics.cpu.map(d => d.value));

    if (config?.cpuLimit && maxCpu > config.cpuLimit * 0.9) {
      recommendations.push({
        type: 'scale_up',
        priority: 'high',
        title: 'Increase CPU Limits',
        description: `Current CPU limit (${config.cpuLimit}) is frequently exceeded. Increase to ${(config.cpuLimit * 1.5).toFixed(0)} to prevent throttling.`,
        action: 'Update resource limits in spec',
        impact: 'Improved performance, reduced latency'
      });
    } else if (avgCpu < 20 && config?.cpuLimit) {
      recommendations.push({
        type: 'cost',
        priority: 'low',
        title: 'Reduce CPU Requests',
        description: `Average CPU usage is ${avgCpu.toFixed(1)}%. Consider reducing CPU requests to optimize costs.`,
        action: 'Lower CPU requests to match actual usage',
        impact: 'Cost savings, better cluster utilization'
      });
    }
  }

  // Memory-based recommendations
  if (metrics?.memory && metrics.memory.length > 0) {
    const avgMemory = metrics.memory.reduce((sum, d) => sum + d.value, 0) / metrics.memory.length;
    const maxMemory = Math.max(...metrics.memory.map(d => d.value));

    if (config?.memoryLimit && maxMemory > config.memoryLimit * 0.85) {
      recommendations.push({
        type: 'scale_up',
        priority: 'high',
        title: 'Increase Memory Limits',
        description: `Memory usage approaches limit. Increase to ${(config.memoryLimit * 1.3).toFixed(0)} to prevent OOMKills.`,
        action: 'Update memory limits in spec',
        impact: 'Prevent crashes, improve stability'
      });
    }
  }

  // Restart-based recommendations
  if (status?.restarts && status.restarts > 5) {
    recommendations.push({
      type: 'investigate',
      priority: status.restarts > 10 ? 'critical' : 'high',
      title: 'Investigate Frequent Restarts',
      description: `${status.restarts} restarts detected. Check logs for OOMKills, probe failures, or application errors.`,
      action: 'Review logs and events',
      impact: 'Improved reliability and uptime'
    });
  }

  // Deployment-specific recommendations
  if (resourceType.toLowerCase() === 'deployment' && config?.replicas === 1) {
    recommendations.push({
      type: 'optimize',
      priority: 'medium',
      title: 'Enable High Availability',
      description: 'Single replica deployment. Consider scaling to 2+ replicas for zero-downtime updates and resilience.',
      action: 'Increase replicas to 2 or more',
      impact: 'Improved availability during updates'
    });
  }

  // Security recommendation (example)
  recommendations.push({
    type: 'security',
    priority: 'low',
    title: 'Review Security Context',
    description: 'Ensure pod security context follows best practices (non-root user, read-only filesystem, etc.)',
    action: 'Review and update securityContext',
    impact: 'Enhanced security posture'
  });

  return recommendations;
}

// Assess overall health
function assessHealth(insights: ResourceInsight[], status?: any): {
  score: number;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  summary: string;
} {
  let score = 100;

  // Deduct based on insights
  insights.forEach(insight => {
    switch (insight.severity) {
      case 'critical':
        score -= 20;
        break;
      case 'warning':
        score -= 10;
        break;
      case 'info':
        score -= 2;
        break;
    }
  });

  // Deduct for restarts
  if (status?.restarts) {
    score -= Math.min(30, status.restarts * 3);
  }

  score = Math.max(0, Math.min(100, score));

  let statusLabel: 'healthy' | 'warning' | 'critical' | 'unknown' = 'unknown';
  let summary = '';

  if (score >= 80) {
    statusLabel = 'healthy';
    summary = 'Resource is operating normally with no significant issues';
  } else if (score >= 60) {
    statusLabel = 'warning';
    summary = 'Resource has some issues that should be addressed';
  } else {
    statusLabel = 'critical';
    summary = 'Resource has critical issues requiring immediate attention';
  }

  return { score, status: statusLabel, summary };
}

export function useResourceInsights(options: UseResourceInsightsOptions): UseResourceInsightsResult {
  const { enabled = true } = options;

  const [insights, setInsights] = useState<ResourceInsight[]>([]);
  const [recommendations, setRecommendations] = useState<ResourceRecommendation[]>([]);
  const [healthAssessment, setHealthAssessment] = useState({
    score: 100,
    status: 'unknown' as const,
    summary: 'Analyzing resource...'
  });
  const [predictions, setPredictions] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anomaly detection for CPU
  const { anomalies: cpuAnomalies } = useAnomalyDetection({
    metricName: `${options.resourceType}_cpu`,
    metricType: 'cpu',
    data: options.metrics?.cpu || [],
    sensitivity: 'medium',
    enabled: enabled && (options.metrics?.cpu?.length || 0) > 0
  });

  // Trend analysis for CPU
  const { trend: cpuTrend } = useTrendAnalysis({
    metricName: `${options.resourceType}_cpu`,
    metricType: 'cpu',
    data: options.metrics?.cpu || [],
    enabled: enabled && (options.metrics?.cpu?.length || 0) > 0
  });

  // Trend analysis for Memory
  const { trend: memoryTrend } = useTrendAnalysis({
    metricName: `${options.resourceType}_memory`,
    metricType: 'memory',
    data: options.metrics?.memory || [],
    enabled: enabled && (options.metrics?.memory?.length || 0) > 0
  });

  const analyze = () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      // Generate insights
      const generatedInsights = generateInsights(options);

      // Add anomaly insights
      if (cpuAnomalies.length > 0) {
        generatedInsights.push({
          category: 'performance',
          severity: 'warning',
          title: 'CPU Anomaly Detected',
          message: `${cpuAnomalies.length} CPU anomalies detected in recent metrics`,
          details: cpuAnomalies[0]?.message,
          timestamp: new Date()
        });
      }

      setInsights(generatedInsights);

      // Generate recommendations
      const generatedRecommendations = generateRecommendations(options, generatedInsights);
      setRecommendations(generatedRecommendations);

      // Assess health
      const health = assessHealth(generatedInsights, options.status);
      setHealthAssessment(health);

      // Set predictions
      setPredictions({
        cpuTrend: cpuTrend?.direction,
        memoryTrend: memoryTrend?.direction,
        timeToCapacity: calculateTimeToCapacity(cpuTrend, options.config?.cpuLimit)
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Resource insights error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    analyze();
  }, [
    JSON.stringify(options.metrics),
    JSON.stringify(options.config),
    JSON.stringify(options.status),
    enabled
  ]);

  return {
    insights,
    recommendations,
    healthAssessment,
    predictions,
    isLoading,
    error,
    refresh: analyze
  };
}

function calculateTimeToCapacity(trend: any, limit?: number): string | undefined {
  if (!trend || !limit || trend.direction !== 'increasing') {
    return undefined;
  }

  const currentValue = trend.forecast?.[0] || 0;
  const remaining = limit - currentValue;
  const hoursToCapacity = remaining / trend.slope;

  if (hoursToCapacity <= 0 || hoursToCapacity > 720) {
    return undefined;
  }

  if (hoursToCapacity < 24) {
    return `~${Math.round(hoursToCapacity)} hours`;
  } else {
    return `~${Math.round(hoursToCapacity / 24)} days`;
  }
}
