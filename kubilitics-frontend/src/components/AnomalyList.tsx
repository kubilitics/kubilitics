import { useState, useEffect } from 'react';
import { AnomalyCard } from './AnomalyCard';
import { Anomaly } from '@/hooks/useAnomalyDetection';

interface AnomalyListProps {
  anomalies: Anomaly[];
  maxVisible?: number;
}

interface DismissedAnomaly {
  timestamp: string;
  dismissedAt: number;
}

interface SnoozedAnomaly {
  timestamp: string;
  snoozedUntil: number;
}

export function AnomalyList({ anomalies, maxVisible = 5 }: AnomalyListProps) {
  const [dismissed, setDismissed] = useState<DismissedAnomaly[]>([]);
  const [snoozed, setSnoozed] = useState<SnoozedAnomaly[]>([]);

  // Load dismissed and snoozed from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('anomaly-dismissed');
    if (stored) {
      setDismissed(JSON.parse(stored));
    }

    const storedSnoozed = localStorage.getItem('anomaly-snoozed');
    if (storedSnoozed) {
      setSnoozed(JSON.parse(storedSnoozed));
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('anomaly-dismissed', JSON.stringify(dismissed));
  }, [dismissed]);

  useEffect(() => {
    localStorage.setItem('anomaly-snoozed', JSON.stringify(snoozed));
  }, [snoozed]);

  // Clean up expired snoozes
  useEffect(() => {
    const now = Date.now();
    const activeSnoozed = snoozed.filter(s => s.snoozedUntil > now);
    if (activeSnoozed.length !== snoozed.length) {
      setSnoozed(activeSnoozed);
    }
  }, [snoozed]);

  const handleDismiss = (timestamp: string) => {
    setDismissed(prev => [...prev, {
      timestamp,
      dismissedAt: Date.now()
    }]);
  };

  const handleSnooze = (timestamp: string, duration: number) => {
    setSnoozed(prev => [...prev, {
      timestamp,
      snoozedUntil: Date.now() + duration
    }]);
  };

  // Filter out dismissed and snoozed anomalies
  const visibleAnomalies = anomalies.filter(anomaly => {
    const isDismissed = dismissed.some(d => d.timestamp === anomaly.timestamp);
    if (isDismissed) return false;

    const isSnoozed = snoozed.some(s =>
      s.timestamp === anomaly.timestamp && s.snoozedUntil > Date.now()
    );
    if (isSnoozed) return false;

    return true;
  });

  // Sort by severity and limit
  const sortedAnomalies = visibleAnomalies
    .sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    })
    .slice(0, maxVisible);

  if (sortedAnomalies.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Active Anomalies</h2>
        <span className="text-sm text-gray-500">
          {sortedAnomalies.length} detected
        </span>
      </div>

      <div className="space-y-2">
        {sortedAnomalies.map((anomaly, index) => (
          <AnomalyCard
            key={`${anomaly.timestamp}-${index}`}
            anomaly={anomaly}
            onDismiss={handleDismiss}
            onSnooze={handleSnooze}
          />
        ))}
      </div>

      {visibleAnomalies.length > maxVisible && (
        <p className="text-sm text-gray-500 text-center">
          +{visibleAnomalies.length - maxVisible} more anomalies
        </p>
      )}
    </div>
  );
}
