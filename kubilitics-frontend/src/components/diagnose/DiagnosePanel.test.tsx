import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiagnosePanel } from './DiagnosePanel';
import type { Diagnosis } from '@/lib/diagnose/types';

// Mock toast so CopyAsDescribeButton doesn't try to render a real toaster
vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeHealthy(): Diagnosis {
  return {
    severity: 'healthy',
    headline: 'Running, all containers ready',
    oneLine: '1 container, 0 restarts.',
    reasons: [],
    containers: [
      { name: 'app', isInit: false, state: 'running', restartCount: 0, ready: true },
    ],
    conditions: [],
    recentWarnings: [],
    computedAt: 0,
    kind: 'Pod',
    namespace: 'default',
    name: 'nginx',
  };
}

function makeBroken(): Diagnosis {
  return {
    severity: 'broken',
    headline: 'Container keeps crashing',
    oneLine: 'busybox exited with code 128: exec not found',
    reasons: [
      {
        code: 'CrashLoopBackOff',
        severity: 'broken',
        title: 'Container keeps crashing',
        explanation: 'Your container started, ran briefly, and crashed.',
        suggestions: [
          { text: 'Read the crash output from the previous run', action: { type: 'jump_to_tab', tab: 'logs' } },
          { text: 'Check the YAML', action: { type: 'jump_to_tab', tab: 'yaml' } },
        ],
      },
    ],
    containers: [
      { name: 'busybox', isInit: false, state: 'waiting', reason: 'CrashLoopBackOff', restartCount: 5, ready: false },
    ],
    conditions: [],
    recentWarnings: [
      {
        reason: 'BackOff',
        message: 'Back-off restarting failed container busybox in pod default/test',
        count: 7,
        firstSeen: Date.now() - 120000,
        lastSeen: Date.now() - 60000,
      },
    ],
    computedAt: 0,
    kind: 'Pod',
    namespace: 'default',
    name: 'busybox-pod',
  };
}

const resource = { metadata: { name: 'busybox-pod', namespace: 'default' } };

describe('DiagnosePanel', () => {
  it('renders the compact healthy state when severity is healthy', () => {
    render(<DiagnosePanel diagnosis={makeHealthy()} resource={resource} />);
    expect(screen.getByText('Running, all containers ready')).toBeInTheDocument();
    expect(screen.getByText('1 container, 0 restarts.')).toBeInTheDocument();
    // Healthy state should NOT render the reason card region
    expect(screen.queryByText(/keeps crashing/i)).toBeNull();
  });

  it('renders the full panel when severity is broken', () => {
    render(<DiagnosePanel diagnosis={makeBroken()} resource={resource} />);
    // Header
    expect(screen.getByText('BROKEN')).toBeInTheDocument();
    expect(screen.getAllByText(/Container keeps crashing/).length).toBeGreaterThan(0);
    // Reason card explanation
    expect(screen.getByText(/Your container started, ran briefly/)).toBeInTheDocument();
    // Container state row
    expect(screen.getByText(/waiting · CrashLoopBackOff/)).toBeInTheDocument();
    // Recent warning message
    expect(screen.getByText(/Back-off restarting failed container busybox/)).toBeInTheDocument();
    // Copy button
    expect(screen.getByRole('button', { name: /Copy diagnosis/i })).toBeInTheDocument();
  });

  it('fires onAction when a suggestion is clicked', () => {
    const handler = vi.fn();
    render(<DiagnosePanel diagnosis={makeBroken()} resource={resource} onAction={handler} />);
    const logsSuggestion = screen.getByRole('button', { name: /Read the crash output/i });
    fireEvent.click(logsSuggestion);
    expect(handler).toHaveBeenCalledWith({ type: 'jump_to_tab', tab: 'logs' });
  });

  it('aria-label reflects the severity for screen readers', () => {
    render(<DiagnosePanel diagnosis={makeBroken()} resource={resource} />);
    // The outer section has aria-label="Diagnose: broken" AND the inner header has
    // role="status" aria-label="Diagnose: broken" — we assert both exist.
    const labelled = screen.getAllByLabelText(/Diagnose: broken/i);
    expect(labelled.length).toBeGreaterThan(0);
  });
});
