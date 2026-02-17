import { useMemo } from 'react';
import { ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Activity, Zap } from 'lucide-react';
import { DataPoint } from '@/hooks/useAnomalyDetection';
import { MLAnomaly } from '@/hooks/useMLAnomalyDetection';

interface MLAnomalyChartProps {
  title?: string;
  data: DataPoint[];
  anomalies: MLAnomaly[];
  showConfidenceBands?: boolean;
  height?: number;
}

export function MLAnomalyChart({
  title = "ML Anomaly Detection",
  data,
  anomalies,
  showConfidenceBands = true,
  height = 300
}: MLAnomalyChartProps) {
  // Transform data for chart
  const chartData = useMemo(() => {
    const anomalyMap = new Map(
      anomalies.map(a => [a.timestamp, a])
    );

    return data.map(point => {
      const anomaly = anomalyMap.get(point.timestamp);

      return {
        time: new Date(point.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        }),
        timestamp: point.timestamp,
        value: point.value,
        isAnomaly: !!anomaly,
        anomalyScore: anomaly?.score || 0,
        severity: anomaly?.severity || 'normal'
      };
    });
  }, [data, anomalies]);

  // Separate normal and anomaly points
  const normalPoints = chartData.filter(d => !d.isAnomaly);
  const anomalyPoints = chartData.filter(d => d.isAnomaly);

  // Calculate statistics
  const stats = useMemo(() => {
    const values = data.map(d => d.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const max = Math.max(...values);
    const min = Math.min(...values);

    return { mean, median, max, min };
  }, [data]);

  const getAnomalyColor = (severity: string) => {
    switch (severity) {
      case 'critical': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#3b82f6';
      default: return '#6b7280';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
      case 'high':
        return <AlertTriangle className="h-3 w-3" />;
      case 'medium':
        return <Activity className="h-3 w-3" />;
      default:
        return <Zap className="h-3 w-3" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {anomalies.length} anomalies
            </Badge>
            <Badge variant="secondary" className="text-xs">
              Isolation Forest
            </Badge>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
          <div className="text-center">
            <p className="text-muted-foreground">Mean</p>
            <p className="font-semibold">{stats.mean.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Median</p>
            <p className="font-semibold">{stats.median.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Max</p>
            <p className="font-semibold">{stats.max.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Min</p>
            <p className="font-semibold">{stats.min.toFixed(2)}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px'
              }}
              content={({ active, payload }) => {
                if (active && payload && payload.length > 0) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white p-2 border rounded shadow-sm">
                      <p className="text-xs font-semibold">{data.time}</p>
                      <p className="text-xs">Value: {data.value.toFixed(2)}</p>
                      {data.isAnomaly && (
                        <>
                          <p className="text-xs text-red-600 font-semibold mt-1">
                            Anomaly Detected
                          </p>
                          <p className="text-xs">
                            Score: {(data.anomalyScore * 100).toFixed(1)}%
                          </p>
                          <p className="text-xs capitalize">
                            Severity: {data.severity}
                          </p>
                        </>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />

            {/* Mean line */}
            <ReferenceLine
              y={stats.mean}
              stroke="#3b82f6"
              strokeDasharray="5 5"
              label={{
                value: 'Mean',
                position: 'right',
                fontSize: 10,
                fill: '#3b82f6'
              }}
            />

            {/* Normal points */}
            <Scatter
              name="Normal"
              data={normalPoints}
              fill="#3b82f6"
              fillOpacity={0.6}
            />

            {/* Anomaly points - colored by severity */}
            {['critical', 'high', 'medium', 'low'].map(severity => {
              const points = anomalyPoints.filter(p => p.severity === severity);
              if (points.length === 0) return null;

              return (
                <Scatter
                  key={severity}
                  name={`${severity.charAt(0).toUpperCase() + severity.slice(1)} Anomaly`}
                  data={points}
                  fill={getAnomalyColor(severity)}
                  fillOpacity={0.8}
                  shape="diamond"
                />
              );
            })}

            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              wrapperStyle={{ fontSize: '11px' }}
            />
          </ScatterChart>
        </ResponsiveContainer>

        {/* Anomaly List */}
        {anomalies.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold">Detected Anomalies:</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {anomalies.slice(0, 5).map((anomaly, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs p-2 rounded bg-gray-50"
                >
                  <div className="flex items-center gap-2">
                    <div className={`text-${anomaly.severity === 'critical' ? 'red' : anomaly.severity === 'high' ? 'orange' : 'yellow'}-600`}>
                      {getSeverityIcon(anomaly.severity)}
                    </div>
                    <span className="font-mono">
                      {new Date(anomaly.timestamp).toLocaleTimeString()}
                    </span>
                    <span>Value: {anomaly.value.toFixed(2)}</span>
                  </div>
                  <Badge
                    variant={anomaly.severity === 'critical' ? 'destructive' : 'outline'}
                    className="text-xs capitalize"
                  >
                    {anomaly.severity}
                  </Badge>
                </div>
              ))}
              {anomalies.length > 5 && (
                <p className="text-xs text-muted-foreground text-center">
                  +{anomalies.length - 5} more anomalies
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
