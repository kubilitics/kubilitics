import { AlertCircle, TrendingUp, X } from 'lucide-react';
import { Trend } from '@/hooks/useTrendAnalysis';

interface CapacityAlertProps {
  trend: Trend;
  resourceName: string;
  currentValue: number;
  capacity: number;
  onDismiss?: () => void;
}

export function CapacityAlert({
  trend,
  resourceName,
  currentValue,
  capacity,
  onDismiss
}: CapacityAlertProps) {
  // Calculate time to exhaustion based on trend
  const calculateTimeToExhaustion = () => {
    if (trend.direction !== 'increasing' || trend.slope <= 0) {
      return null;
    }

    const remaining = capacity - currentValue;
    const hoursToExhaustion = remaining / trend.slope;

    if (hoursToExhaustion <= 0 || hoursToExhaustion > 720) { // 30 days
      return null;
    }

    return hoursToExhaustion;
  };

  const timeToExhaustion = calculateTimeToExhaustion();

  // Only show alert if confidence is high enough and time to exhaustion is critical
  if (trend.confidence === 'low' || !timeToExhaustion || timeToExhaustion > 168) { // 7 days
    return null;
  }

  const formatTimeToExhaustion = (hours: number) => {
    if (hours < 1) {
      return `${Math.round(hours * 60)} minutes`;
    } else if (hours < 24) {
      return `${Math.round(hours)} hours`;
    } else {
      return `${Math.round(hours / 24)} days`;
    }
  };

  const getAlertSeverity = () => {
    if (timeToExhaustion < 24) return 'critical';
    if (timeToExhaustion < 72) return 'high';
    return 'medium';
  };

  const severity = getAlertSeverity();

  const getSeverityStyle = () => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-500 text-red-900';
      case 'high':
        return 'bg-orange-100 border-orange-500 text-orange-900';
      default:
        return 'bg-yellow-100 border-yellow-500 text-yellow-900';
    }
  };

  const getProgressBarColor = () => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500';
      case 'high':
        return 'bg-orange-500';
      default:
        return 'bg-yellow-500';
    }
  };

  const utilizationPercent = (currentValue / capacity) * 100;

  return (
    <div className={`border-l-4 rounded-lg p-4 shadow-md ${getSeverityStyle()}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6" />
          <div>
            <h3 className="font-semibold text-base">
              Capacity Alert: {resourceName}
            </h3>
            <p className="text-sm mt-1">
              Projected to reach capacity in{' '}
              <span className="font-semibold">
                {formatTimeToExhaustion(timeToExhaustion)}
              </span>
            </p>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 rounded hover:bg-white/50 transition-colors"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs mb-1">
          <span>Current: {currentValue.toFixed(2)}</span>
          <span>Capacity: {capacity.toFixed(2)}</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full ${getProgressBarColor()} transition-all`}
            style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
          />
        </div>
        <p className="text-xs mt-1 text-right">
          {utilizationPercent.toFixed(1)}% utilized
        </p>
      </div>

      {/* Trend Info */}
      <div className="mt-4 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <TrendingUp className="h-4 w-4" />
          <span>
            Trend: {trend.direction} ({(trend.slope * 100).toFixed(2)}%/hr)
          </span>
        </div>
        <div>
          <span>
            Confidence: {trend.confidence} ({(trend.r_squared * 100).toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* Recommendations */}
      <div className="mt-4 p-3 bg-white/50 rounded">
        <p className="text-sm font-semibold mb-2">Recommended Actions:</p>
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li>Scale up resources before capacity is reached</li>
          <li>Investigate the cause of increased demand</li>
          <li>Consider implementing auto-scaling</li>
          {severity === 'critical' && (
            <li className="font-semibold">⚠️ Immediate action required</li>
          )}
        </ul>
      </div>
    </div>
  );
}
