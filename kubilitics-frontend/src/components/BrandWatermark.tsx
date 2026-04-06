/**
 * BrandWatermark — Persistent Kubilitics branding for fullscreen/presentation views.
 *
 * Matches enterprise conventions (Datadog, Grafana, Splunk):
 * - Persistent navbar logos are 24-32px in those products
 * - Our floating watermark uses 44px to compensate for hidden app chrome
 * - Glass-morphism pill with backdrop blur for non-intrusive overlay
 * - pointer-events: none so it never blocks interaction
 */
import { BrandLogo } from './BrandLogo';
import { cn } from '@/lib/utils';

interface BrandWatermarkProps {
  /** Position on screen. Default: 'top-left' */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Additional CSS classes */
  className?: string;
}

const positionClasses = {
  'top-left': 'top-5 left-5',
  'top-right': 'top-5 right-5',
  'bottom-left': 'bottom-5 left-5',
  'bottom-right': 'bottom-5 right-5',
};

export function BrandWatermark({
  position = 'top-left',
  className,
}: BrandWatermarkProps) {
  return (
    <div
      className={cn(
        'absolute z-50 flex items-center gap-3 rounded-2xl',
        'border border-white/25 dark:border-slate-600/50',
        'bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl',
        'px-5 py-3 shadow-xl select-none pointer-events-none',
        positionClasses[position],
        className,
      )}
    >
      <BrandLogo height={44} variant="dark" className="dark:hidden" />
      <BrandLogo height={44} variant="light" className="hidden dark:block" />
    </div>
  );
}
