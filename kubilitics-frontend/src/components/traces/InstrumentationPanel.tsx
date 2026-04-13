/**
 * InstrumentationPanel — read-only view shown on a Deployment's Traces tab.
 *
 * Displays:
 *  - Detected language and confidence
 *  - The kubectl annotate command the user should run
 *  - Pre-flight checks (read-only preview)
 *  - Verify command
 *  - Manual instrumentation guide for languages the OTel Operator can't auto-inject
 *
 * No mutation. No buttons that modify cluster state. Just commands the user copies.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useBackendConfigStore, getEffectiveBackendBaseUrl } from '@/stores/backendConfigStore';
import { getInstrumentCommand } from '@/services/api/observability';
import type { InstrumentCommandResponse, ContainerInstrumentation } from '@/services/api/observability';

interface InstrumentationPanelProps {
  clusterId: string;
  namespace: string;
  resourceName: string; // deployment name
}

export function InstrumentationPanel({ clusterId, namespace, resourceName }: InstrumentationPanelProps) {
  const storedUrl = useBackendConfigStore((s) => s.backendBaseUrl);
  const baseUrl = getEffectiveBackendBaseUrl(storedUrl);

  const { data, isLoading } = useQuery({
    queryKey: ['instrument-command', clusterId, namespace, resourceName],
    queryFn: () => getInstrumentCommand(baseUrl, clusterId, namespace, resourceName),
    enabled: !!clusterId && !!namespace && !!resourceName,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const container =
    data.containers.find((c) => c.name === selectedContainer) ?? data.containers[0];
  if (!container) return null;

  const isInstrumented = container.instrumented;
  const supportsAuto = container.supports_auto;

  return (
    <div className="space-y-3 p-4">
      {data.containers.length > 1 && (
        <ContainerPicker
          containers={data.containers}
          selected={container.name}
          onSelect={setSelectedContainer}
        />
      )}
      <DetectionCard container={container} />
      {isInstrumented ? (
        <InstrumentedView data={data} />
      ) : supportsAuto ? (
        <NotInstrumentedAutoView data={data} />
      ) : (
        <NotInstrumentedManualView container={container} resourceName={resourceName} />
      )}
    </div>
  );
}

function ContainerPicker({
  containers,
  selected,
  onSelect,
}: {
  containers: ContainerInstrumentation[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-xs text-muted-foreground mr-1">Container:</span>
      {containers.map((c) => (
        <button
          key={c.name}
          type="button"
          onClick={() => onSelect(c.name)}
          className={cn(
            'text-xs font-medium px-2 py-1 rounded transition-colors',
            selected === c.name
              ? 'bg-primary/10 text-primary border border-primary/20'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function DetectionCard({ container }: { container: ContainerInstrumentation }) {
  const confidenceColor =
    container.confidence === 'high'
      ? 'text-emerald-600 dark:text-emerald-400'
      : container.confidence === 'medium'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-muted-foreground';

  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Detected:</span>
          <span className="text-sm font-medium text-foreground capitalize">
            {container.detected_language || 'unknown'}
          </span>
          <span className={cn('text-[10px] uppercase font-semibold tracking-wider', confidenceColor)}>
            ({container.confidence})
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          from {container.detection_source}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10.5px] text-muted-foreground truncate" title={container.image}>
        {container.image}
      </div>
    </div>
  );
}

function NotInstrumentedAutoView({ data }: { data: InstrumentCommandResponse }) {
  return (
    <>
      <CommandBlock title="Run this command to instrument" command={data.command} />
      <PreflightView preflight={data.preflight} />
      <CommandBlock title="Verify after running" command={data.verify_command} compact />
    </>
  );
}

function InstrumentedView({ data }: { data: InstrumentCommandResponse }) {
  return (
    <>
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
        <span className="text-sm font-medium text-foreground">Instrumented</span>
      </div>
      <CommandBlock title="To remove instrumentation" command={data.uninstrument_command} />
    </>
  );
}

function NotInstrumentedManualView({
  container,
  resourceName,
}: {
  container: ContainerInstrumentation;
  resourceName: string;
}) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Auto-instrumentation not available for {container.detected_language || 'this language'}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            The OpenTelemetry Operator only supports Java, Python, Node.js, Go, and .NET. For other
            languages, set these environment variables on your container and add the appropriate OTel SDK
            calls in your code:
          </p>
          <pre className="mt-2 font-mono text-[10.5px] leading-[1.6] bg-card border border-border/40 rounded p-2 text-foreground select-all whitespace-pre-wrap break-all">
{`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.kubilitics-system:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=${resourceName}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

function CommandBlock({
  title,
  command,
  compact = false,
}: {
  title: string;
  command: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(command);
    toast.success('Copied to clipboard');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!command) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <Button size="sm" variant="ghost" className="h-6 gap-1.5 text-xs hover:bg-primary/10" onClick={copy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre
        className={cn(
          'font-mono bg-muted/40 border border-border/40 rounded p-2 select-all whitespace-pre-wrap break-all tabular-nums',
          compact ? 'text-[10.5px] leading-[1.6]' : 'text-[12px] leading-[1.6]',
        )}
      >
        {command}
      </pre>
    </div>
  );
}

function PreflightView({ preflight }: { preflight: InstrumentCommandResponse['preflight'] }) {
  if (!preflight || preflight.checks.length === 0) return null;
  const blockingFailures = preflight.checks.filter((c) => c.severity === 'blocking' && !c.passed);
  return (
    <div className="rounded-md border border-border/40 bg-card">
      <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">Pre-flight checks</span>
        {blockingFailures.length > 0 && (
          <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
            Fix these first
          </span>
        )}
      </div>
      <div className="divide-y divide-border/30">
        {preflight.checks.map((c, i) => {
          const icon =
            c.severity === 'blocking' && !c.passed ? (
              <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            ) : c.severity === 'warning' && !c.passed ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            ) : c.severity === 'info' ? (
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            );
          return (
            <div key={i} className="flex items-start gap-2 px-3 py-2">
              {icon}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground">{c.message}</p>
                {c.detail && <p className="text-[10.5px] text-muted-foreground mt-0.5">{c.detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
