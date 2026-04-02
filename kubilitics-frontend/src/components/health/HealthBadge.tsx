/**
 * HealthBadge — small reusable badge showing health score + level color.
 * Can be embedded in ClusterOverview cards, table rows, or headers.
 */
import { cn } from '@/lib/utils';

export interface HealthBadgeProps {
  score: number;
  level: string;
  size?: 'sm' | 'md' | 'lg';
}

const LEVEL_STYLES: Record<string, string> = {
  healthy:
    'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10',
  low:
    'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10',
  warning:
    'text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20 bg-yellow-50 dark:bg-yellow-500/10',
  medium:
    'text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20 bg-yellow-50 dark:bg-yellow-500/10',
  degraded:
    'text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/10',
  high:
    'text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/10',
  critical:
    'text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10',
};

const SIZE_CLASSES = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
};

function getLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    healthy: 'Healthy',
    warning: 'Warning',
    degraded: 'Degraded',
    critical: 'Critical',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  };
  return labels[level] ?? level;
}

export function HealthBadge({ score, level, size = 'md' }: HealthBadgeProps) {
  const levelStyle = LEVEL_STYLES[level] ?? LEVEL_STYLES.warning;
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border font-semibold tabular-nums',
        levelStyle,
        sizeClass,
      )}
    >
      <span className="font-bold">{Math.round(score)}</span>
      <span className="opacity-80">{getLevelLabel(level)}</span>
    </div>
  );
}
