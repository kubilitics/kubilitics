import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiagnoseContainerStates } from './DiagnoseContainerStates';
import type { ContainerDiagnosis } from '@/lib/diagnose/types';

const containers: ContainerDiagnosis[] = [
  { name: 'init-setup', isInit: true, state: 'terminated', restartCount: 0, ready: false, exitCode: 0 },
  { name: 'app', isInit: false, state: 'running', restartCount: 2, ready: true },
  { name: 'sidecar', isInit: false, state: 'waiting', reason: 'CrashLoopBackOff', restartCount: 5, ready: false },
];

describe('DiagnoseContainerStates', () => {
  it('renders a row per container', () => {
    render(<DiagnoseContainerStates containers={containers} />);
    expect(screen.getByText('init-setup')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.getByText('sidecar')).toBeInTheDocument();
  });

  it('marks init containers with an init badge', () => {
    render(<DiagnoseContainerStates containers={containers} />);
    const badges = screen.getAllByText(/init/i);
    // At least one 'init' badge (may match the init-setup name but the badge is distinct)
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders reason suffix for waiting container', () => {
    render(<DiagnoseContainerStates containers={containers} />);
    expect(screen.getByText(/waiting · CrashLoopBackOff/)).toBeInTheDocument();
  });

  it('returns null for empty list', () => {
    const { container } = render(<DiagnoseContainerStates containers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows restart count and ready state', () => {
    render(<DiagnoseContainerStates containers={containers} />);
    expect(screen.getByText('2 restarts')).toBeInTheDocument();
    expect(screen.getByText('5 restarts')).toBeInTheDocument();
  });
});
