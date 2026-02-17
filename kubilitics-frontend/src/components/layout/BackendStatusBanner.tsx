/**
 * Banner shown when backend is configured but unreachable (health check fails).
 * Per A3.5 / C2.3: clear UI, recovery actions, and request ID for support when available.
 */
import { AlertCircle, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackendHealth } from '@/hooks/useBackendHealth';
import { useBackendConfigStore } from '@/stores/backendConfigStore';
import { BackendApiError } from '@/services/backendApiClient';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function BackendStatusBanner({ className }: { className?: string }) {
  const isConfigured = useBackendConfigStore((s) => s.isBackendConfigured);
  const health = useBackendHealth({ enabled: true });

  if (!isConfigured()) return null;
  if (!health.error) return null;

  const message = health.error instanceof Error ? health.error.message : 'Backend unreachable';
  const requestId = health.error instanceof BackendApiError ? health.error.requestId : undefined;

  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-4 py-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive',
        className
      )}
      role="alert"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="text-sm font-medium truncate">
          Backend unreachable: {message}
        </span>
        <span className="text-xs text-muted-foreground shrink-0"> (data below may be cached and outdated)</span>
        </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={() => health.refetch()}
          disabled={health.isFetching}
          className="gap-1"
        >
          <RefreshCw className={cn('h-4 w-4', health.isFetching && 'animate-spin')} />
          Retry
        </Button>
        <Button size="sm" variant="outline" asChild className="gap-1">
          <Link to="/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </Button>
      </div>
      {requestId && (
        <p className="text-xs text-muted-foreground pl-7">
          Request ID: <code className="bg-muted px-1 rounded">{requestId}</code> (for support)
        </p>
      )}
      </div>
    </div>
  );
}
