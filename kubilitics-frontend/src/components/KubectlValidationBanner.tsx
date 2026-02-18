import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { isTauri } from '@/lib/tauri';
import { Button } from '@/components/ui/button';

interface KubectlStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export function KubectlValidationBanner() {
  const [kubectlStatus, setKubectlStatus] = useState<KubectlStatus | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isTauri() || checked) return;

    const checkKubectl = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<KubectlStatus>('check_kubectl_installed');
        setKubectlStatus(status);
      } catch (error) {
        console.error('Failed to check kubectl:', error);
        setKubectlStatus({ installed: false });
      } finally {
        setChecked(true);
      }
    };

    checkKubectl();
  }, [checked]);

  if (!isTauri() || !checked || !kubectlStatus || kubectlStatus.installed) {
    return null;
  }

  return (
    <Alert variant="destructive" className="m-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-900 dark:text-amber-100">
        kubectl Not Found
      </AlertTitle>
      <AlertDescription className="text-amber-800 dark:text-amber-200">
        <p className="mb-2">
          kubectl is required for shell features to work. Please install kubectl to use the terminal.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.open('https://kubernetes.io/docs/tasks/tools/', '_blank');
            }}
            className="border-amber-600 text-amber-900 hover:bg-amber-100 dark:border-amber-400 dark:text-amber-100 dark:hover:bg-amber-900/30"
          >
            <ExternalLink className="mr-2 h-3 w-3" />
            Installation Guide
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
