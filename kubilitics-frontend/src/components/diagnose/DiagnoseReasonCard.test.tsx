import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiagnoseReasonCard } from './DiagnoseReasonCard';
import type { ReasonCode } from '@/lib/diagnose/types';

const sampleReason: ReasonCode = {
  code: 'CrashLoopBackOff',
  severity: 'broken',
  title: 'Container keeps crashing',
  explanation: 'Your container started, ran briefly, and crashed.',
  suggestions: [
    {
      text: 'Read the crash output from the previous run',
      kubectlHint: 'kubectl logs -n {namespace} {pod} --previous',
      action: { type: 'jump_to_tab', tab: 'logs' },
    },
    {
      text: 'Check the container command and args in the YAML',
      action: { type: 'jump_to_tab', tab: 'yaml' },
    },
    {
      text: 'Exit code 128 almost always means a missing binary',
    },
  ],
};

describe('DiagnoseReasonCard', () => {
  it('renders the title and explanation', () => {
    render(<DiagnoseReasonCard reason={sampleReason} />);
    expect(screen.getByText('Container keeps crashing')).toBeInTheDocument();
    expect(screen.getByText('Your container started, ran briefly, and crashed.')).toBeInTheDocument();
  });

  it('renders all suggestions', () => {
    render(<DiagnoseReasonCard reason={sampleReason} />);
    expect(screen.getByText('Read the crash output from the previous run')).toBeInTheDocument();
    expect(screen.getByText('Check the container command and args in the YAML')).toBeInTheDocument();
    expect(screen.getByText('Exit code 128 almost always means a missing binary')).toBeInTheDocument();
  });

  it('renders kubectl hint with substitutions', () => {
    render(
      <DiagnoseReasonCard reason={sampleReason} substitutions={{ namespace: 'prod', pod: 'api-7' }} />,
    );
    expect(screen.getByText('kubectl logs -n prod api-7 --previous')).toBeInTheDocument();
  });

  it('fires onSuggestionAction when an actionable suggestion is clicked', () => {
    const handler = vi.fn();
    render(<DiagnoseReasonCard reason={sampleReason} onSuggestionAction={handler} />);
    const logsButton = screen.getByRole('button', { name: /Read the crash output/ });
    fireEvent.click(logsButton);
    expect(handler).toHaveBeenCalledWith({ type: 'jump_to_tab', tab: 'logs' });
  });

  it('suggestions without actions render as plain text (no button)', () => {
    render(<DiagnoseReasonCard reason={sampleReason} />);
    // The third suggestion has no action; it should NOT be a button
    const plainSuggestion = screen.getByText('Exit code 128 almost always means a missing binary');
    expect(plainSuggestion.closest('button')).toBeNull();
  });
});
