import { useState } from 'react';
import { AlertCircle, Send, Copy, RefreshCw, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ErrorTracker, type CrashReport } from '@/lib/errorTracker';

interface CrashReportDialogProps {
    error: Error;
    errorId: string | null;
}

export function CrashReportDialog({ error, errorId }: CrashReportDialogProps) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [copied, setCopied] = useState(false);

    const hasRemote = ErrorTracker.hasRemoteEndpoint();
    const report = ErrorTracker.buildCrashReport(error);

    const handleSendReport = async () => {
        setSending(true);
        try {
            await ErrorTracker.submitCrashReport(report);
            setSent(true);
        } finally {
            setSending(false);
        }
    };

    const formatReportForClipboard = (r: CrashReport): string => {
        const lines = [
            '## Kubilitics Crash Report',
            '',
            `**App Version:** ${r.appVersion}`,
            `**Platform:** ${r.platform}`,
            `**Timestamp:** ${r.timestamp}`,
            `**User Agent:** ${r.userAgent}`,
            '',
            '### Error',
            `**${r.triggeringError.name}:** ${r.triggeringError.message}`,
            '',
            '```',
            r.triggeringError.stack ?? '(no stack trace)',
            '```',
            '',
            `### Recent Errors (${r.recentErrors.length})`,
        ];

        for (const entry of r.recentErrors.slice(-10)) {
            const errObj = entry.error as { name?: string; message?: string };
            lines.push(`- [${entry.timestamp}] ${errObj?.name ?? 'Unknown'}: ${errObj?.message ?? String(entry.error)}`);
        }

        return lines.join('\n');
    };

    const handleCopyToClipboard = async () => {
        const text = formatReportForClipboard(report);
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for older browsers / Tauri
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleRestart = () => {
        window.location.reload();
    };

    return (
        <Dialog open modal>
            <DialogContent
                className="sm:max-w-lg"
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-2">
                        <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                    </div>
                    <DialogTitle className="text-center text-red-700 dark:text-red-400">
                        Something went wrong
                    </DialogTitle>
                    <DialogDescription className="text-center">
                        {error.message || 'An unexpected error occurred.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    {errorId && (
                        <p className="text-xs text-muted-foreground text-center">
                            Error ID: <span className="font-mono select-all">{errorId}</span>
                        </p>
                    )}

                    {/* Collapsible Technical Details */}
                    <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                        <CollapsibleTrigger asChild>
                            <button className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
                                {detailsOpen ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                Technical Details
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <div className="mt-2 bg-slate-100 dark:bg-slate-800 p-3 rounded-md overflow-auto max-h-48 text-xs font-mono text-red-900 dark:text-red-300 border border-slate-200 dark:border-slate-700 space-y-1">
                                <div className="font-bold">
                                    {error.name}: {error.message || '(no message)'}
                                </div>
                                {error.stack && (
                                    <div className="text-slate-600 dark:text-slate-400 text-[10px] whitespace-pre-wrap">
                                        {error.stack}
                                    </div>
                                )}
                                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400">
                                    <div>App Version: {report.appVersion}</div>
                                    <div>Platform: {report.platform}</div>
                                    <div>Buffered Errors: {report.recentErrors.length}</div>
                                </div>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                </div>

                <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-2">
                    {hasRemote ? (
                        <Button
                            onClick={handleSendReport}
                            disabled={sending || sent}
                            variant="default"
                            className="w-full sm:w-auto"
                        >
                            {sent ? (
                                <>
                                    <Check className="mr-2 h-4 w-4" />
                                    Report Sent
                                </>
                            ) : (
                                <>
                                    <Send className="mr-2 h-4 w-4" />
                                    {sending ? 'Sending...' : 'Send Report'}
                                </>
                            )}
                        </Button>
                    ) : (
                        <Button
                            onClick={handleCopyToClipboard}
                            variant="outline"
                            className="w-full sm:w-auto"
                        >
                            {copied ? (
                                <>
                                    <Check className="mr-2 h-4 w-4" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy to Clipboard
                                </>
                            )}
                        </Button>
                    )}
                    <Button onClick={handleRestart} variant="default" className="w-full sm:w-auto">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Restart App
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
