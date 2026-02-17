import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TableEmptyStateProps {
  /** Resource-specific icon (e.g. from KubernetesIcons or lucide-react) */
  icon: ReactNode;
  /** Title, e.g. "No Deployments found" */
  title: string;
  /** Optional subtitle for context, e.g. "No deployments in this namespace" or "Clear filters to see resources" */
  subtitle?: ReactNode;
  /** Show "Clear filters" button when user has active search/filters */
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  /** When creation is supported: label for the create button, e.g. "Create Deployment" */
  createLabel?: string;
  /** When creation is supported: opens ResourceCreator or create flow */
  onCreate?: () => void;
  className?: string;
}

/**
 * Standard empty state for list page tables. Use when the table has no rows to display.
 * Shows resource icon, title, optional subtitle, optional "Clear filters", and optional "Create" button.
 */
export function TableEmptyState({
  icon,
  title,
  subtitle,
  hasActiveFilters,
  onClearFilters,
  createLabel,
  onCreate,
  className,
}: TableEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-12', className)}>
      <div className="rounded-full bg-muted/50 p-4 text-muted-foreground [&>svg]:h-10 [&>svg]:w-10 [&>svg]:opacity-60">
        {icon}
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-medium text-foreground">{title}</p>
        {subtitle && <p className="text-sm text-muted-foreground max-w-sm mx-auto">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {hasActiveFilters && onClearFilters && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
        {createLabel && onCreate && (
          <Button size="sm" className="gap-2" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            {createLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
