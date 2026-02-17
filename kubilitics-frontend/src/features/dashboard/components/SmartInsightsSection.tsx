import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { AnomalyList } from "@/components/AnomalyList";
import { CapacityAlert } from "@/components/CapacityAlert";
import { useAnomalyDetection, type DataPoint } from "@/hooks/useAnomalyDetection";
import { useTrendAnalysis } from "@/hooks/useTrendAnalysis";
import { getAnomalies } from "@/services/aiService";

// Convert AI analytics anomalies to DataPoints for the analysis hooks.
// This replaces the previous Math.random() mock generator.
function aiAnomaliesToDataPoints(anomalies: Awaited<ReturnType<typeof getAnomalies>>): DataPoint[] {
  const cpuAnomalies = anomalies.filter(a => a.metric.toLowerCase().includes('cpu'));
  if (cpuAnomalies.length === 0) return [];
  return cpuAnomalies
    .map(a => ({ timestamp: a.detected_at, value: a.value }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export const SmartInsightsSection = () => {
  const [metricData, setMetricData] = useState<DataPoint[]>([]);
  const [dismissedCapacity, setDismissedCapacity] = useState(false);

  // Fetch real AI anomaly data on mount (replaces mock generator)
  const loadMetricData = useCallback(async () => {
    try {
      const anomalies = await getAnomalies();
      const pts = aiAnomaliesToDataPoints(anomalies);
      if (pts.length > 0) setMetricData(pts);
      // If no real data yet (backend not connected), leave empty — don't generate fake data
    } catch {
      // AI backend not reachable — show nothing rather than fake data
    }
  }, []);

  useEffect(() => {
    loadMetricData();
  }, [loadMetricData]);

  // Anomaly detection — calls real API (useAnomalyDetection → POST /api/v1/analytics/anomalies)
  const { anomalies, isLoading: anomaliesLoading } = useAnomalyDetection({
    metricName: 'cluster_cpu_usage',
    metricType: 'cpu',
    data: metricData,
    sensitivity: 'medium',
    enabled: metricData.length > 0,
    refreshInterval: 30000 // 30 seconds
  });

  // Trend analysis for capacity forecasting
  const { trend } = useTrendAnalysis({
    metricName: 'cluster_cpu_usage',
    metricType: 'cpu',
    data: metricData,
    forecastSteps: 10,
    enabled: metricData.length > 0,
    refreshInterval: 60000 // 1 minute
  });

  const currentValue = metricData.length > 0 ? metricData[metricData.length - 1].value : 0;
  const capacity = 100; // 100% CPU capacity

  return (
    <div className="space-y-4">
      {/* Capacity Alert */}
      {trend && !dismissedCapacity && (
        <CapacityAlert
          trend={trend}
          resourceName="Cluster CPU"
          currentValue={currentValue}
          capacity={capacity}
          onDismiss={() => setDismissedCapacity(true)}
        />
      )}

      {/* Anomaly Cards */}
      {!anomaliesLoading && anomalies.length > 0 && (
        <Card className="border-none glass-panel">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="w-4 h-4 text-cosmic-purple fill-current" />
              <span className="text-gradient font-bold">Detected Anomalies</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AnomalyList anomalies={anomalies} maxVisible={3} />
          </CardContent>
        </Card>
      )}
    </div>
  );
};
