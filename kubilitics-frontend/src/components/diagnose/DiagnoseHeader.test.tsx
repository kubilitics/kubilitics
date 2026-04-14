import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiagnoseHeader } from './DiagnoseHeader';
import type { Diagnosis } from '@/lib/diagnose/types';

function makeDiagnosis(overrides: Partial<Diagnosis>): Diagnosis {
  return {
    severity: 'broken',
    headline: 'Container keeps crashing',
    oneLine: 'busybox exited with code 128: exec not found',
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

describe('DiagnoseHeader', () => {
  it('renders BROKEN label for broken severity', () => {
    render(<DiagnoseHeader diagnosis={makeDiagnosis({ severity: 'broken' })} />);
    expect(screen.getByText('BROKEN')).toBeInTheDocument();
    expect(screen.getByText('Container keeps crashing')).toBeInTheDocument();
    expect(screen.getByText('busybox exited with code 128: exec not found')).toBeInTheDocument();
  });

  it('renders Degraded label for degraded severity', () => {
    render(<DiagnoseHeader diagnosis={makeDiagnosis({ severity: 'degraded' })} />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders Unknown label for unknown severity', () => {
    render(<DiagnoseHeader diagnosis={makeDiagnosis({ severity: 'unknown' })} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('has the correct aria-label', () => {
    render(<DiagnoseHeader diagnosis={makeDiagnosis({ severity: 'broken' })} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Diagnose: broken');
  });
});
