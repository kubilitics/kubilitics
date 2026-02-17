/**
 * Export – PNG format
 * High DPI export with configurable background
 */
import type { Core } from 'cytoscape';
import { EXPORT_BG } from '../renderer/styles';

export function exportAsPNG(cy: Core, options?: { bg?: string; scale?: number }): string | undefined {
  const { bg = EXPORT_BG, scale = 2 } = options || {};
  try {
    return cy.png({ full: true, scale, bg });
  } catch {
    return undefined;
  }
}

export function downloadPNG(cy: Core, filename = 'topology.png', options?: { bg?: string; scale?: number }) {
  const data = exportAsPNG(cy, options);
  if (!data) return;
  const link = document.createElement('a');
  link.download = filename;
  link.href = data;
  link.click();
}
