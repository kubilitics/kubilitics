/**
 * InstallCommandBlock — copy-pasteable command in a code block with three
 * distribution channel tabs (Helm, kubectl, Kustomize).
 */
import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TracingInstallCommands } from '@/services/api/observability';

interface InstallCommandBlockProps {
  commands: TracingInstallCommands;
  className?: string;
  /** When 'ready', host page dims this block to signal it's already installed */
  dimmed?: boolean;
}

type Channel = 'helm' | 'kubectl' | 'kustomize';

const CHANNEL_LABELS: Record<Channel, string> = {
  helm: 'Helm',
  kubectl: 'kubectl',
  kustomize: 'Kustomize',
};

export function InstallCommandBlock({ commands, className, dimmed }: InstallCommandBlockProps) {
  const [channel, setChannel] = useState<Channel>('helm');
  const [copied, setCopied] = useState(false);

  const isLink = channel === 'kustomize';
  const command = channel === 'helm' ? commands.helm : commands.kubectl;

  const handleAction = () => {
    if (isLink) {
      window.open(commands.kustomize_url, '_blank', 'noopener,noreferrer');
      return;
    }
    navigator.clipboard.writeText(command).catch(() => {
      /* clipboard may be blocked */
    });
    toast.success('Command copied', {
      description: 'Paste into your terminal to install.',
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 bg-card overflow-hidden transition-opacity duration-300',
        dimmed && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {/* Channel tab bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-1" role="tablist" aria-label="Install method">
          {(['helm', 'kubectl', 'kustomize'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              aria-controls={`install-panel-${c}`}
              onClick={() => setChannel(c)}
              className={cn(
                'text-xs font-medium px-2.5 py-1 rounded transition-colors',
                channel === c
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleAction}
          className="h-7 gap-1.5 text-xs hover:bg-primary/10"
          aria-label={isLink ? 'Open Kustomize layout in GitHub' : copied ? 'Copied' : 'Copy command'}
        >
          {isLink ? (
            <>
              Open in GitHub <ExternalLink className="h-3 w-3" />
            </>
          ) : copied ? (
            <>
              <Check className="h-3 w-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </Button>
      </div>

      {/* Command body */}
      <div
        id={`install-panel-${channel}`}
        role="tabpanel"
        className="px-4 py-3 bg-muted/20 shadow-[inset_0_2px_4px_0_rgb(0_0_0/0.04)]"
      >
        {isLink ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Kustomize layout lives in the GitHub repo. Click{' '}
            <strong className="text-foreground font-medium">Open in GitHub</strong> to view it.
          </p>
        ) : (
          <pre
            className={cn(
              'font-mono text-[13px] leading-[1.6] whitespace-pre-wrap break-all',
              'text-foreground select-all tabular-nums',
            )}
          >
            {command}
          </pre>
        )}
      </div>
    </div>
  );
}
