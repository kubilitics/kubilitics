import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Semantic status variants for consistent pill styling across list pages. */
export type StatusPillVariant = 'success' | 'warning' | 'error' | 'neutral';

const variantStyles: Record<StatusPillVariant, { bg: string; color: string }> = {
  success: { bg: 'bg-[hsl(142,76%,36%)]/10', color: 'text-[hsl(142,76%,36%)]' },
  warning: { bg: 'bg-[hsl(45,93%,47%)]/10', color: 'text-[hsl(45,93%,47%)]' },
  error: { bg: 'bg-[hsl(0,72%,51%)]/10', color: 'text-[hsl(0,72%,51%)]' },
  neutral: { bg: 'bg-muted', color: 'text-muted-foreground' },
};

export interface StatusPillProps {
  label: string;
  variant: StatusPillVariant;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Standard status pill for list tables. Use for status, readiness, or state columns
 * so Pods, Deployments, and ResourceList pages share the same look.
 */
export function StatusPill({ label, variant, icon: Icon, className }: StatusPillProps) {
  const style = variantStyles[variant];
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium min-w-0 max-w-full truncate',
        style.bg,
        style.color,
        className
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
      <span className="truncate">{label}</span>
    </div>
  );
}
