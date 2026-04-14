import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiagnoseRecentEvents } from './DiagnoseRecentEvents';
import type { WarningEvent } from '@/lib/diagnose/types';

const now = Date.now();

const events: WarningEvent[] = [
  {
    reason: 'BackOff',
    message: 'Back-off restarting failed container busybox in pod default/wrong-container-command-pod',
    count: 7,
    firstSeen: now - 120_000,
    lastSeen: now - 60_000,
  },
  {
    reason: 'Failed',
    message: 'Error: failed to create containerd task: exec: "invalid-command" not found',
    count: 5,
    firstSeen: now - 180_000,
    lastSeen: now - 90_000,
  },
];

describe('DiagnoseRecentEvents', () => {
  it('renders the full message as the primary line', () => {
    render(<DiagnoseRecentEvents events={events} />);
    expect(
      screen.getByText(/Back-off restarting failed container busybox/),
    ).toBeInTheDocument();
  });

  it('shows reason, age, and aggregation count on secondary line', () => {
    render(<DiagnoseRecentEvents events={events} />);
    expect(screen.getByText('BackOff')).toBeInTheDocument();
    expect(screen.getByText('x7')).toBeInTheDocument();
  });

  it('sorts events by lastSeen descending (newest first)', () => {
    render(<DiagnoseRecentEvents events={events} />);
    const messages = screen.getAllByText(/Back-off|Error: failed/);
    // First match should be BackOff (newer lastSeen)
    expect(messages[0].textContent).toContain('Back-off');
  });

  it('returns null for empty list', () => {
    const { container } = render(<DiagnoseRecentEvents events={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
