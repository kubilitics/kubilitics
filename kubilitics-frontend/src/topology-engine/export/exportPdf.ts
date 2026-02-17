/**
 * Export – PDF format
 * Converts PNG to PDF (browser-side)
 * For production: use server-side PDF generation
 */
import type { Core } from 'cytoscape';
import { exportAsPNG } from './exportPng';

export function downloadPDF(cy: Core, filename = 'topology.pdf') {
  // In browser: export as high-res PNG and open print dialog
  const pngData = exportAsPNG(cy, { scale: 3, bg: '#ffffff' });
  if (!pngData) return;

  // Open in new window for print-to-PDF
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Kubilitics Topology – ${filename}</title>
          <style>
            body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; }
            img { max-width: 100%; height: auto; }
            @media print { body { margin: 0; } img { width: 100%; } }
          </style>
        </head>
        <body>
          <img src="${pngData}" alt="Topology" />
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
}
