/**
 * Export – SVG format
 * Uses Cytoscape's built-in SVG export with poster-mode layout
 */
import type { Core } from 'cytoscape';

export function exportAsSVG(cy: Core): string | undefined {
  try {
    return (cy as any).svg({ full: true, scale: 2 });
  } catch {
    return undefined;
  }
}

export function downloadSVG(cy: Core, filename = 'topology.svg') {
  const svgData = exportAsSVG(cy);
  if (!svgData) return;
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
