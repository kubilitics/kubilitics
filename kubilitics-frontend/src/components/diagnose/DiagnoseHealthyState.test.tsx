import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiagnoseHealthyState } from './DiagnoseHealthyState';
import type { Diagnosis } from '@/lib/diagnose/types';

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    severity: 'healthy',
    headline: 'Running, all containers ready',
    oneLine: '1 container, 0 restarts.',
    reasons: [],
    containers: [],
    conditions: [],
    recentWarnings: [],
    computedAt: 0,
    kind: 'Pod',
    namespace: 'default',
    name: 'test-pod',
    ...overrides,
  };
}

describe('DiagnoseHealthyState', () => {
  it('renders the headline and one-line summary', () => {
    render(<DiagnoseHealthyState diagnosis={makeDiagnosis()} />);
    expect(screen.getByText('Running, all containers ready')).toBeInTheDocument();
    expect(screen.getByText('1 container, 0 restarts.')).toBeInTheDocument();
  });

  it('has the healthy aria label for screen readers', () => {
    render(<DiagnoseHealthyState diagnosis={makeDiagnosis()} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Diagnose: healthy');
  });

  it('renders the action slot when provided', () => {
    render(
      <DiagnoseHealthyState
        diagnosis={makeDiagnosis()}
        action={<button>Copy</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
