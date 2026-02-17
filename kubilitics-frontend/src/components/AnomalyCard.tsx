import { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, X, Clock } from 'lucide-react';
import { Anomaly } from '@/hooks/useAnomalyDetection';

interface AnomalyCardProps {
  anomaly: Anomaly;
  onDismiss?: (timestamp: string) => void;
  onSnooze?: (timestamp: string, duration: number) => void;
}

export function AnomalyCard({ anomaly, onDismiss, onSnooze }: AnomalyCardProps) {
  const [showActions, setShowActions] = useState(false);

  const getIcon = () => {
    switch (anomaly.type) {
      case 'spike':
        return <TrendingUp className="h-5 w-5" />;
      case 'drop':
        return <TrendingDown className="h-5 w-5" />;
      case 'flapping':
        return <Activity className="h-5 w-5" />;
      default:
        return <AlertTriangle className="h-5 w-5" />;
    }
  };

  const getCardStyle = () => {
    switch (anomaly.severity) {
      case 'critical':
        return 'border-red-500 bg-red-50 text-red-900';
      case 'high':
        return 'border-orange-500 bg-orange-50 text-orange-900';
      case 'medium':
        return 'border-yellow-500 bg-yellow-50 text-yellow-900';
      case 'low':
        return 'border-blue-500 bg-blue-50 text-blue-900';
      default:
        return 'border-gray-500 bg-gray-50 text-gray-900';
    }
  };

  const getIconColor = () => {
    switch (anomaly.severity) {
      case 'critical':
        return 'text-red-600';
      case 'high':
        return 'text-orange-600';
      case 'medium':
        return 'text-yellow-600';
      case 'low':
        return 'text-blue-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDeviation = (deviation: number) => {
    return `${deviation > 0 ? '+' : ''}${deviation.toFixed(2)}%`;
  };

  return (
    <div
      className={`relative border-l-4 rounded-lg p-4 shadow-md transition-all hover:shadow-lg ${getCardStyle()}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={getIconColor()}>
            {getIcon()}
          </div>
          <div>
            <h3 className="font-semibold text-sm capitalize">
              {anomaly.type} Detected
            </h3>
            <p className="text-xs opacity-75 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimestamp(anomaly.timestamp)}
            </p>
          </div>
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex items-center gap-2">
            {onSnooze && (
              <button
                onClick={() => onSnooze(anomaly.timestamp, 3600000)} // 1 hour
                className="text-xs px-2 py-1 rounded bg-white/50 hover:bg-white/80 transition-colors"
                title="Snooze for 1 hour"
              >
                Snooze
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(anomaly.timestamp)}
                className="p-1 rounded hover:bg-white/80 transition-colors"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Message */}
      <p className="mt-2 text-sm">
        {anomaly.message}
      </p>

      {/* Metrics */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="opacity-75">Current</p>
          <p className="font-semibold">{anomaly.value.toFixed(2)}</p>
        </div>
        <div>
          <p className="opacity-75">Expected</p>
          <p className="font-semibold">{anomaly.expected_value.toFixed(2)}</p>
        </div>
        <div>
          <p className="opacity-75">Deviation</p>
          <p className="font-semibold">{formatDeviation(anomaly.deviation)}</p>
        </div>
      </div>

      {/* Severity Badge */}
      <div className="absolute top-2 right-2">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          anomaly.severity === 'critical' ? 'bg-red-200 text-red-800' :
          anomaly.severity === 'high' ? 'bg-orange-200 text-orange-800' :
          anomaly.severity === 'medium' ? 'bg-yellow-200 text-yellow-800' :
          'bg-blue-200 text-blue-800'
        }`}>
          {anomaly.severity.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
