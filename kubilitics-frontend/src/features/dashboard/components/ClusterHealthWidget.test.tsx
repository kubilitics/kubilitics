/**
 * UX-1 (docs/PRODUCTION-HARDENING-ROADMAP.md, Phase 7) regression tests.
 *
 * Before this fix, ClusterHealthWidget never checked useHealthScore's (now
 * added) isLoading/isError signals — a still-loading or failed health check
 * rendered identically to a confidently-computed "0, grade F, critical"
 * score. These tests prove loading and error now render distinct,
 * non-misleading states instead of a fabricated score.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/stores/clusterPresenceStore', () => ({
  useActiveCluster: () => ({ id: 'c1', name: 'test-cluster' }),
}));
vi.mock('@/hooks/useActiveClusterId', () => ({
  useActiveClusterId: () => 'c1',
}));
vi.mock('@/stores/backendConfigStore', () => ({
  useBackendConfigStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ isBackendConfigured: () => true }),
}));

const mockOverview = vi.fn();
vi.mock('@/hooks/useClusterOverview', () => ({
  useClusterOverview: () => mockOverview(),
}));

const mockHealthScore = vi.fn();
vi.mock('@/hooks/useHealthScore', () => ({
  useHealthScore: () => mockHealthScore(),
}));

import { ClusterHealthWidget } from './ClusterHealthWidget';

const baseHealthScore = {
  score: 0,
  grade: 'F' as const,
  status: 'critical' as const,
  breakdown: { podHealth: 0, nodeHealth: 0, workloadHealth: 0, stability: 0, eventHealth: 0 },
  details: [],
  insight: '',
};

describe('ClusterHealthWidget — loading/error states (UX-1)', () => {
  it('shows a loading state, not a fabricated 0/critical score, while data is in flight', () => {
    mockOverview.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockHealthScore.mockReturnValue({ ...baseHealthScore, isLoading: true, isError: false });

    render(<TooltipProvider><ClusterHealthWidget /></TooltipProvider>);

    expect(screen.getByRole('status', { name: /loading cluster health/i })).toBeInTheDocument();
    expect(screen.queryByText('At Risk')).not.toBeInTheDocument();
  });

  it('shows an explicit error state, not a fabricated score, when every data source fails', () => {
    mockOverview.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockHealthScore.mockReturnValue({ ...baseHealthScore, isLoading: false, isError: true });

    render(<TooltipProvider><ClusterHealthWidget /></TooltipProvider>);

    expect(screen.getByRole('alert')).toHaveTextContent(/unable to load cluster health/i);
    expect(screen.queryByText('At Risk')).not.toBeInTheDocument();
  });

  it('renders the real score once data has actually arrived', () => {
    mockOverview.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockHealthScore.mockReturnValue({
      ...baseHealthScore,
      score: 92,
      grade: 'A',
      status: 'excellent',
      isLoading: false,
      isError: false,
    });

    render(<TooltipProvider><ClusterHealthWidget /></TooltipProvider>);

    expect(screen.queryByRole('status', { name: /loading cluster health/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The score itself renders inside a recharts <PieChart>'s SVG <text>
    // label, which recharts skips when ResponsiveContainer measures 0x0 (as
    // it does under jsdom) — asserting on the header status badge instead,
    // which is plain DOM and exercises the same isLoading/isError gate.
    expect(screen.getByText('Good State')).toBeInTheDocument();
  });
});
