import { useMemo } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { DataPoint } from '@/hooks/useAnomalyDetection';
import { ForecastPoint } from '@/hooks/useTimeSeriesForecast';

interface ForecastChartProps {
  title?: string;
  historicalData: DataPoint[];
  forecasts: ForecastPoint[];
  unit?: string;
  height?: number;
  showConfidenceBands?: boolean;
}

export function ForecastChart({
  title = "Time Series Forecast",
  historicalData,
  forecasts,
  unit = '',
  height = 300,
  showConfidenceBands = true
}: ForecastChartProps) {
  // Combine historical and forecast data
  const chartData = useMemo(() => {
    const historical = historicalData.map(point => ({
      time: new Date(point.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      timestamp: point.timestamp,
      actual: point.value,
      forecast: null,
      lower: null,
      upper: null,
      type: 'historical'
    }));

    const forecast = forecasts.map(point => ({
      time: new Date(point.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      timestamp: point.timestamp,
      actual: null,
      forecast: point.value,
      lower: point.lower_95,
      upper: point.upper_95,
      type: 'forecast'
    }));

    return [...historical, ...forecast];
  }, [historicalData, forecasts]);

  // Calculate trend
  const trend = useMemo(() => {
    if (forecasts.length < 2) return null;

    const firstForecast = forecasts[0].value;
    const lastForecast = forecasts[forecasts.length - 1].value;
    const change = ((lastForecast - firstForecast) / firstForecast) * 100;

    return {
      direction: change > 5 ? 'increasing' : change < -5 ? 'decreasing' : 'stable',
      percentage: Math.abs(change).toFixed(1)
    };
  }, [forecasts]);

  // Calculate statistics
  const stats = useMemo(() => {
    const historicalValues = historicalData.map(d => d.value);
    const forecastValues = forecasts.map(f => f.value);

    const historicalMean = historicalValues.reduce((sum, v) => sum + v, 0) / historicalValues.length;
    const forecastMean = forecastValues.reduce((sum, v) => sum + v, 0) / forecastValues.length;

    return {
      historicalMean,
      forecastMean,
      change: forecastMean - historicalMean,
      changePercent: ((forecastMean - historicalMean) / historicalMean) * 100
    };
  }, [historicalData, forecasts]);

  const getTrendIcon = () => {
    if (!trend) return <Minus className="h-4 w-4" />;

    switch (trend.direction) {
      case 'increasing':
        return <TrendingUp className="h-4 w-4 text-orange-600" />;
      case 'decreasing':
        return <TrendingDown className="h-4 w-4 text-green-600" />;
      default:
        return <Minus className="h-4 w-4 text-blue-600" />;
    }
  };

  const getTrendColor = () => {
    if (!trend) return 'text-gray-600';

    switch (trend.direction) {
      case 'increasing':
        return 'text-orange-600';
      case 'decreasing':
        return 'text-green-600';
      default:
        return 'text-blue-600';
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
            {trend && (
              <div className={`flex items-center gap-1 text-xs font-medium ${getTrendColor()}`}>
                {getTrendIcon()}
                <span>{trend.percentage}%</span>
              </div>
            )}
            <Badge variant="secondary" className="text-xs">
              ARIMA
            </Badge>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
          <div className="text-center">
            <p className="text-muted-foreground">Historical Avg</p>
            <p className="font-semibold">{stats.historicalMean.toFixed(2)}{unit}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Forecast Avg</p>
            <p className="font-semibold">{stats.forecastMean.toFixed(2)}{unit}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Change</p>
            <p className={`font-semibold ${stats.change > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {stats.change > 0 ? '+' : ''}{stats.changePercent.toFixed(1)}%
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorConfidence" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e0e7ff" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#e0e7ff" stopOpacity={0.1} />
              </linearGradient>
            </defs>

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
                      {data.actual !== null && (
                        <p className="text-xs">Actual: {data.actual.toFixed(2)}{unit}</p>
                      )}
                      {data.forecast !== null && (
                        <>
                          <p className="text-xs font-semibold text-purple-600">
                            Forecast: {data.forecast.toFixed(2)}{unit}
                          </p>
                          {showConfidenceBands && (
                            <p className="text-xs text-gray-600">
                              95% CI: [{data.lower.toFixed(2)}, {data.upper.toFixed(2)}]
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />

            {/* Confidence bands */}
            {showConfidenceBands && (
              <Area
                type="monotone"
                dataKey="upper"
                stroke="none"
                fill="url(#colorConfidence)"
                fillOpacity={0.3}
              />
            )}

            {/* Historical data */}
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#colorActual)"
              dot={false}
              name="Historical"
            />

            {/* Forecast */}
            <Area
              type="monotone"
              dataKey="forecast"
              stroke="#8b5cf6"
              strokeWidth={2}
              strokeDasharray="5 5"
              fill="url(#colorForecast)"
              dot={false}
              name="Forecast"
            />

            {/* Lower confidence band */}
            {showConfidenceBands && (
              <Area
                type="monotone"
                dataKey="lower"
                stroke="none"
                fill="url(#colorConfidence)"
                fillOpacity={0.3}
              />
            )}

            {/* Divider line between historical and forecast */}
            {historicalData.length > 0 && (
              <ReferenceLine
                x={chartData[historicalData.length - 1]?.time}
                stroke="#6b7280"
                strokeDasharray="3 3"
                label={{
                  value: 'Now',
                  position: 'top',
                  fontSize: 10,
                  fill: '#6b7280'
                }}
              />
            )}

            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="line"
              wrapperStyle={{ fontSize: '11px' }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Forecast Summary */}
        {forecasts.length > 0 && (
          <div className="mt-4 p-3 bg-purple-50 rounded-lg">
            <p className="text-xs font-semibold text-purple-900 mb-2">
              Forecast Summary ({forecasts.length} steps ahead)
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-purple-700">Next value:</span>
                <span className="font-semibold ml-1">
                  {forecasts[0].value.toFixed(2)}{unit}
                </span>
              </div>
              <div>
                <span className="text-purple-700">Final value:</span>
                <span className="font-semibold ml-1">
                  {forecasts[forecasts.length - 1].value.toFixed(2)}{unit}
                </span>
              </div>
              <div>
                <span className="text-purple-700">Trend:</span>
                <span className={`font-semibold ml-1 capitalize ${getTrendColor()}`}>
                  {trend?.direction || 'stable'}
                </span>
              </div>
              <div>
                <span className="text-purple-700">Confidence:</span>
                <span className="font-semibold ml-1">95%</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
