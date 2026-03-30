/**
 * UpdateChecker -- checks for app updates on startup via Tauri's updater plugin.
 *
 * Renders nothing visible by itself; it uses sonner toasts for user communication:
 *  - Non-intrusive info toast when an update is available
 *  - Progress toast during download
 *  - Success/error toasts for completion states
 *
 * Only runs inside the Tauri desktop shell (no-ops in the browser).
 */
import { useEffect, useRef } from 'react';
import { isTauri } from '@/lib/tauri';
import { toast } from '@/components/ui/sonner';

// Delay before checking (let the app finish booting)
const CHECK_DELAY_MS = 5_000;

export function UpdateChecker() {
  const hasChecked = useRef(false);

  useEffect(() => {
    if (!isTauri() || hasChecked.current) return;
    hasChecked.current = true;

    const timer = setTimeout(() => {
      checkForUpdate();
    }, CHECK_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  return null;
}

async function checkForUpdate() {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (!update) return; // Already on the latest version

    const version = update.version;
    const toastId = `update-available-${version}`;

    toast.info(`Update available: v${version}`, {
      id: toastId,
      duration: Infinity,
      action: {
        label: 'Install',
        onClick: () => downloadAndInstall(update, version),
      },
      description: 'A new version of Kubilitics is ready.',
    });
  } catch (err) {
    // Silently ignore update check failures -- the user should not be
    // bothered if the update server is unreachable or signing keys are
    // not yet configured.
    console.warn('[UpdateChecker] Failed to check for updates:', err);
  }
}

async function downloadAndInstall(
  update: Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater')['check']>> & object,
  version: string,
) {
  const progressToastId = `update-progress-${version}`;

  try {
    toast.loading(`Downloading v${version}...`, {
      id: progressToastId,
      duration: Infinity,
    });

    let lastPercent = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === 'Started' && event.data.contentLength) {
        const totalMB = (event.data.contentLength / 1_048_576).toFixed(1);
        toast.loading(`Downloading v${version} (${totalMB} MB)...`, {
          id: progressToastId,
          duration: Infinity,
        });
      } else if (event.event === 'Progress' && event.data.contentLength) {
        const percent = Math.round(
          (event.data.chunkLength / event.data.contentLength) * 100,
        );
        // Only update the toast every 10% to avoid over-rendering
        if (percent >= lastPercent + 10) {
          lastPercent = percent;
          toast.loading(`Downloading v${version}... ${percent}%`, {
            id: progressToastId,
            duration: Infinity,
          });
        }
      } else if (event.event === 'Finished') {
        toast.dismiss(progressToastId);
      }
    });

    toast.success(`v${version} installed -- restart to apply.`, {
      id: `update-done-${version}`,
      duration: 8_000,
      action: {
        label: 'Restart now',
        onClick: async () => {
          try {
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          } catch {
            toast.info('Please restart the app manually.');
          }
        },
      },
    });
  } catch (err) {
    toast.dismiss(progressToastId);
    console.error('[UpdateChecker] Download/install failed:', err);
    toast.error('Update failed. Please try again later.', {
      id: `update-error-${version}`,
    });
  }
}
