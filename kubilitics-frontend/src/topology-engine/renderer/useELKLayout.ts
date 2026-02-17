/**
 * useELKLayout – ELK layout hook for Cytoscape
 * ELK layered is the ONLY layout engine. No dagre, no cola, no force.
 */
import { useCallback } from 'react';
import type { Core } from 'cytoscape';

export interface ELKLayoutOptions {
  'elk.algorithm': string;
  'elk.direction': string;
  'elk.edgeRouting': string;
  'elk.spacing.nodeNode': number;
  'elk.layered.spacing.nodeNodeBetweenLayers': number;
  'elk.layered.crossingMinimization.strategy': string;
  'elk.layered.nodePlacement.strategy': string;
  'elk.layered.mergeEdges': string;
  'elk.padding': string;
}

function getELKOptions(spacingMultiplier = 1): ELKLayoutOptions {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': 80 * spacingMultiplier,
    'elk.layered.spacing.nodeNodeBetweenLayers': 120 * spacingMultiplier,
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.mergeEdges': 'true',
    'elk.padding': `[top=${30 * spacingMultiplier},left=${30 * spacingMultiplier},bottom=${30 * spacingMultiplier},right=${30 * spacingMultiplier}]`,
  };
}

export function getCytoscapeELKLayout(options?: { isExport?: boolean; posterMode?: boolean; animate?: boolean }) {
  const { isExport = false, posterMode = false, animate = true } = options || {};
  const multiplier = posterMode ? 3 : isExport ? 2 : 1;

  return {
    name: 'elk',
    elk: getELKOptions(multiplier),
    animate: !isExport && animate,
    animationDuration: isExport ? 0 : 500,
    animationEasing: 'ease-out' as const,
    fit: true,
    padding: 50,
  };
}

/**
 * Apply ELK layout to a Cytoscape instance
 */
export function applyELKLayout(
  cy: Core,
  options?: { isExport?: boolean; posterMode?: boolean; animate?: boolean }
): Promise<void> {
  return new Promise((resolve) => {
    if (cy.nodes().length === 0) {
      resolve();
      return;
    }
    const layoutOptions = getCytoscapeELKLayout(options);
    const layout = cy.layout(layoutOptions as any);
    layout.on('layoutstop', () => resolve());
    layout.run();
  });
}

/**
 * React hook for applying ELK layout
 */
export function useELKLayout() {
  const runLayout = useCallback((cy: Core, options?: { isExport?: boolean; posterMode?: boolean }) => {
    return applyELKLayout(cy, options);
  }, []);

  return { runLayout };
}
