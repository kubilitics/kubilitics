import { useEffect, useState } from 'react';
import { DataPoint } from './useAnomalyDetection';
import { AI_BASE_URL } from '@/services/aiService';

// Use the canonical AI base URL from aiService (VITE_AI_BACKEND_URL || http://localhost:8081)
const AI_BACKEND_URL = AI_BASE_URL;

export interface Trend {
  direction: 'increasing' | 'decreasing' | 'stable';
  slope: number;
  r_squared: number;
  confidence: 'high' | 'medium' | 'low';
  forecast: number[];
  forecast_timestamps: string[];
}

export interface UseTrendAnalysisOptions {
  metricName: string;
  metricType: 'cpu' | 'memory' | 'network' | 'disk' | 'custom';
  data: DataPoint[];
  forecastSteps?: number;
  enabled?: boolean;
  refreshInterval?: number;
}

export interface UseTrendAnalysisResult {
  trend: Trend | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTrendAnalysis(options: UseTrendAnalysisOptions): UseTrendAnalysisResult {
  const {
    metricName,
    metricType,
    data,
    forecastSteps = 10,
    enabled = true,
    refreshInterval = 60000 // 1 minute default
  } = options;

  const [trend, setTrend] = useState<Trend | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeTrend = async () => {
    if (!enabled || data.length < 3) {
      setTrend(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${AI_BACKEND_URL}/api/v1/analytics/trends`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          time_series: {
            metric_name: metricName,
            metric_type: metricType,
            data: data.map(d => ({
              timestamp: d.timestamp,
              value: d.value
            }))
          },
          forecast_steps: forecastSteps
        })
      });

      if (!response.ok) {
        throw new Error(`Trend analysis failed: ${response.statusText}`);
      }

      const result = await response.json();
      setTrend(result.trend);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Trend analysis error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    analyzeTrend();

    if (refreshInterval > 0) {
      const interval = setInterval(analyzeTrend, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [metricName, metricType, JSON.stringify(data), forecastSteps, enabled, refreshInterval]);

  return {
    trend,
    isLoading,
    error,
    refresh: analyzeTrend
  };
}
