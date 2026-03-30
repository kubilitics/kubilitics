/**
 * CriticalityBanner — Full-width gradient banner showing blast radius severity at a glance.
 *
 * Color-coded by criticality level. Designed for instant comprehension at 3am.
 */
import { cn } from '@/lib/utils';

const GRADIENT_MAP: Record<string, string> = {
  critical: 'from-red-600 to-red-900 dark:from-red-700 dark:to-red-950',
  high: 'from-orange-500 to-orange-800 dark:from-orange-600 dark:to-orange-900',
  medium: 'from-yellow-500 to-yellow-700 dark:from-yellow-600 dark:to-yellow-800',
  low: 'from-blue-500 to-blue-700 dark:from-blue-600 dark:to-blue-800',
};

export interface CriticalityBannerProps {
  criticalityScore: number;
  criticalityLevel: 'critical' | 'high' | 'medium' | 'low';
  blastRadiusPercent: number;
  totalAffected: number;
  affectedNamespaces: number;
  targetName: string;
}

export function CriticalityBanner({
  criticalityScore,
  criticalityLevel,
  blastRadiusPercent,
  totalAffected,
  affectedNamespaces,
  targetName,
}: CriticalityBannerProps) {
  const gradient = GRADIENT_MAP[criticalityLevel] ?? GRADIENT_MAP.low;

  const verdict = totalAffected === 0
    ? `${targetName} has no downstream dependencies`
    : `${totalAffected} resource${totalAffected !== 1 ? 's' : ''} at risk across ${affectedNamespaces} namespace${affectedNamespaces !== 1 ? 's' : ''}`;

  return (
    <div
      className={cn(
        'w-full rounded-xl bg-gradient-to-r px-6 py-5 text-white shadow-lg',
        gradient,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: verdict + blast radius */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white/80 mb-1">
            Impact Analysis for <span className="font-semibold text-white">{targetName}</span>
          </p>
          <p className="text-lg font-semibold leading-snug tracking-tight">
            {verdict}
          </p>
          <p className="mt-1.5 text-sm text-white/70">
            Blast radius: <span className="font-semibold text-white">{blastRadiusPercent}%</span> of cluster
          </p>
        </div>

        {/* Right: score badge */}
        <div className="flex flex-col items-center shrink-0">
          <span className="text-4xl font-extrabold tabular-nums leading-none">
            {criticalityScore}
          </span>
          <span className="mt-1 text-xs font-medium uppercase tracking-widest text-white/80">
            {criticalityLevel}
          </span>
        </div>
      </div>
    </div>
  );
}
