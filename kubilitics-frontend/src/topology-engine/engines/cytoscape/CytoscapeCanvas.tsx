import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
// @ts-ignore
import cytoscapeSvg from 'cytoscape-svg';
import fcose from 'cytoscape-fcose';
import cola from 'cytoscape-cola';
import type { TopologyGraph, HeatMapMode, TopologyNode } from '../../types/topology.types';
import { getHeatmapColor } from '../../renderer/styles';
import type { EngineRef } from '../../types/engine.types';
import type { OverlayType, OverlayData } from '../../types/overlay.types';
import type { BlastRadiusResult } from '../../types/interaction.types';
import { HighlightManager, getHighlightStylesheet } from './HighlightManager';
import { ContextMenu } from './ContextMenu';
import { HoverTooltip } from './HoverTooltip';
import { TopologySearch } from './TopologySearch';

// Register layout extensions ONCE (Dagre, fCoSE, Cola – world-class constraint-based layouts)
if (!Object.prototype.hasOwnProperty.call(cytoscape.prototype, 'dagre')) {
  cytoscape.use(dagre);
}
try {
  cytoscape.use(fcose);
} catch {
  // fcose unavailable (e.g. SSR)
}
try {
  cytoscape.use(cola);
} catch {
  // cola unavailable (e.g. SSR)
}
// Register SVG export (Task 6.2) – run once at load
try {
  cytoscape.use(cytoscapeSvg);
} catch {
  // Already registered or unavailable (e.g. SSR)
}

/**
 * CENTRALIZED RESOURCE COLOR MAP - DARK SATURATED COLORS
 * Single source of truth - OPTIMIZED FOR WHITE BACKGROUND VISIBILITY
 * Using darker, more saturated colors for maximum contrast and clarity
 */
export const CLUSTER_ROOT_ID = 'cluster-root';

export const RESOURCE_COLOR_MAP: Record<string, string> = {
  'Cluster': '#0f172a',          // Root node - dark slate
  'Pod': '#3498DB',              // Vibrant blue
  'Deployment': '#FF6B35',       // Vibrant orange
  'ReplicaSet': '#9B59B6',       // Rich purple
  'StatefulSet': '#1E88E5',      // Bright blue
  'DaemonSet': '#5E35B1',        // Deep purple
  'Job': '#F57C00',              // Vibrant orange
  'CronJob': '#FF9800',          // Bright orange
  'Service': '#2ECC71',          // Fresh green
  'Ingress': '#26A69A',          // Teal
  'Endpoints': '#546E7A',        // Slate
  'EndpointSlice': '#607D8B',    // Blue slate
  'NetworkPolicy': '#FF6F00',    // Amber
  'ConfigMap': '#FFC107',        // Bright yellow
  'Secret': '#E53935',           // Rich red
  'PersistentVolume': '#0097A7', // Cyan
  'PersistentVolumeClaim': '#00ACC1', // Light cyan
  'StorageClass': '#00BCD4',     // Bright cyan
  'Node': '#D32F2F',             // Deep red
  'Namespace': '#7B1FA2',        // Deep purple
  'ServiceAccount': '#AD1457',   // Deep pink
  'Role': '#EC407A',             // Pink
  'ClusterRole': '#C2185B',      // Magenta
  'RoleBinding': '#F06292',      // Light pink
  'ClusterRoleBinding': '#E91E63', // Magenta
};

/** Minimal node data for synthetic cluster root (Cytoscape element data shape). */
interface CyNodeData {
  id: string;
  label: string;
  name: string;
  kind: string;
  namespace: string;
  badge?: string;
}

/** Minimal edge data for hierarchy edges (Cytoscape element data shape). */
interface CyEdgeData {
  id: string;
  source: string;
  target: string;
  relationshipType?: string;
}

/** Tower level: 0 = ns/node head, 1 = deployment-level, 2 = replicaset, 3 = pod, 4 = pod-attached. */
function getTowerLevel(kind: string): number {
  if (kind === 'Namespace' || kind === 'Node') return 0;
  if (['Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Ingress', 'ConfigMap', 'Secret', 'Job', 'CronJob',
    'NetworkPolicy', 'ServiceAccount', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding',
    'ResourceQuota', 'LimitRange', 'HorizontalPodAutoscaler', 'Endpoints', 'EndpointSlice'].includes(kind)) return 1;
  if (kind === 'ReplicaSet') return 2;
  if (['Pod', 'PodGroup', 'Container'].includes(kind)) return 3;
  return 4;
}

const TOWER_WIDTH = 220;
const ROW_GAP = 88;
const LEVEL_BLOCK_GAP = 24;

/**
 * Tower-based hierarchy with EXPLICIT positions: no overlap, readable on one page.
 * Cluster at top center; each namespace and each node is a tower (column); within each tower
 * levels are stacked: deployment-level → replicaset → pod → pod-attached.
 */
/**
 * Tower-based hierarchy with EXPLICIT positions: no overlap, readable on one page.
 * Hierarchy: Cluster -> (Namespaces & Nodes) -> Workloads -> ReplicaSets -> Pods -> Leaf Resources
 */
function buildHierarchicalGraph(graph: TopologyGraph): {
  nodes: Array<{ group: 'nodes'; data: CyNodeData; position: { x: number; y: number } }>;
  edges: Array<{ group: 'edges'; data: CyEdgeData }>;
} {
  const clusterName = graph.metadata?.clusterId || 'Cluster';

  const rootNode: CyNodeData = {
    id: CLUSTER_ROOT_ID,
    label: clusterName,
    name: clusterName,
    kind: 'Cluster',
    namespace: '',
    badge: 'Cluster',
  };

  const namespaces = graph.nodes.filter(n => n.kind === 'Namespace').sort((a, b) => a.name.localeCompare(b.name));
  const k8sNodes = graph.nodes.filter(n => n.kind === 'Node').sort((a, b) => a.name.localeCompare(b.name));

  // Resources that don't have a direct parent yet
  const otherResources = graph.nodes.filter(n => n.kind !== 'Namespace' && n.kind !== 'Node');

  // We'll organize resources into "Towers" based on Namespace.
  const towersNodes = namespaces;
  const towers = towersNodes.map(n => n.id);

  const totalWidth = Math.max(towers.length * TOWER_WIDTH, 600);
  const startX = -totalWidth / 2 + TOWER_WIDTH / 2;

  const positions = new Map<string, { x: number; y: number }>();
  positions.set(CLUSTER_ROOT_ID, { x: 0, y: -200 });

  // Place Tower Heads in the first row
  const row1Y = 100;
  towers.forEach((towerId, idx) => {
    const x = startX + idx * TOWER_WIDTH;
    positions.set(towerId, { x, y: row1Y });
  });

  // Level mapping for workload hierarchy within a tower
  const getResourceLevel = (kind: string): number => {
    if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(kind)) return 1;
    if (kind === 'ReplicaSet') return 2;
    if (kind === 'Pod') return 3;
    if (['Service', 'Ingress', 'ConfigMap', 'Secret', 'PersistentVolumeClaim', 'Endpoints'].includes(kind)) return 4;
    return 5;
  };

  // Group resources by their tower and level
  const resourceGroups = new Map<string, Map<number, TopologyNode[]>>();

  otherResources.forEach(node => {
    let towerId = '';

    if (node.namespace) {
      const nsNode = namespaces.find(ns => ns.name === node.namespace);
      if (nsNode) towerId = nsNode.id;
    }

    if (!towerId) towerId = 'cluster-scoped';

    if (!resourceGroups.has(towerId)) resourceGroups.set(towerId, new Map());
    const levels = resourceGroups.get(towerId)!;
    const level = getResourceLevel(node.kind);
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level)!.push(node);
  });

  const levelGap = 160;

  // Position resources within each tower
  resourceGroups.forEach((levels, towerId) => {
    const towerPos = positions.get(towerId);
    // If it's cluster-scoped, place it on the far right
    const baseX = towerPos ? towerPos.x : (totalWidth / 2 + TOWER_WIDTH);
    const baseY = row1Y + levelGap;

    levels.forEach((nodes, level) => {
      const y = baseY + (level - 1) * levelGap;
      nodes.forEach((node, idx) => {
        const x = baseX + (nodes.length > 1 ? (idx - (nodes.length - 1) / 2) * 110 : 0);
        positions.set(node.id, { x, y });
      });
    });
  });

  // Ensure all Nodes are positioned below the root but above namespaces
  k8sNodes.forEach((n, idx) => {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: (idx - (k8sNodes.length - 1) / 2) * 150, y: -50 });
    }
  });

  const cyNodes = [
    { group: 'nodes' as const, data: rootNode, position: positions.get(CLUSTER_ROOT_ID)! },
    ...graph.nodes.map(node => ({
      group: 'nodes' as const,
      data: {
        id: node.id,
        label: node.name,
        name: node.name,
        kind: node.kind,
        namespace: node.namespace,
        badge: node.kind,
        statusBadge: node.computed.health === 'warning' ? '⚠️' : node.computed.health === 'critical' ? '🔴' : '',
      },
      position: positions.get(node.id) || { x: (Math.random() - 0.5) * 1000, y: 500 }
    }))
  ];

  const edges: Array<{ group: 'edges'; data: CyEdgeData }> = [
    // Cluster -> Namespaces/Nodes
    ...namespaces.map(ns => ({
      group: 'edges' as const,
      data: { id: `root-${ns.id}`, source: CLUSTER_ROOT_ID, target: ns.id, relationshipType: 'contains' }
    })),
    ...k8sNodes.map(n => ({
      group: 'edges' as const,
      data: { id: `root-${n.id}`, source: CLUSTER_ROOT_ID, target: n.id, relationshipType: 'contains' }
    })),
    // Existing relationships
    ...graph.edges.map(edge => ({
      group: 'edges' as const,
      data: {
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        relationshipType: edge.relationshipType,
      }
    })),
    // Implicit hierarchy: Namespace -> Workload
    ...otherResources.filter(r => r.namespace).map(r => {
      const nsNode = namespaces.find(ns => ns.name === r.namespace);
      return nsNode ? {
        group: 'edges' as const,
        data: { id: `ns-h-${nsNode.id}-${r.id}`, source: nsNode.id, target: r.id, relationshipType: 'contains' }
      } : null;
    }).filter(e => e !== null) as any
  ];

  return { nodes: cyNodes, edges };
}

/**
 * FIXED STYLES - OPTIMIZED FOR VISIBILITY ON WHITE BACKGROUND
 */
function getStaticStyles(): cytoscape.StylesheetStyle[] {
  return [
    {
      selector: 'node',
      style: {
        'shape': 'ellipse',
        'background-color': (ele: any) => RESOURCE_COLOR_MAP[ele.data('kind')] || '#64748b',
        'width': (ele: any) => ele.data('kind') === 'Cluster' ? 100 : 72,
        'height': (ele: any) => ele.data('kind') === 'Cluster' ? 100 : 72,
        'border-width': 3,
        'border-color': '#ffffff',
        'border-opacity': 1,
        'shadow-blur': 12,
        'shadow-color': 'rgba(0,0,0,0.2)',
        'shadow-offset-x': 0,
        'shadow-offset-y': 4,

        'label': (ele: any) => {
          const kind = ele.data('kind') || '';
          const name = ele.data('name') || '';
          if (kind === 'Cluster') return name;
          const status = ele.data('statusBadge') || '';
          const maxNameLen = 18;
          const nameStr = name.length > maxNameLen ? name.substring(0, maxNameLen - 1) + '…' : name;
          return `${kind}${status ? ' ' + status : ''}\n${nameStr}`;
        },
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 12,
        'font-size': '12px',
        'font-weight': '600',
        'font-family': '"Inter", system-ui, sans-serif',
        'color': '#1e293b',
        'text-wrap': 'wrap',
        'text-max-width': 140,
        'line-height': 1.4,
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.9,
        'text-background-padding': '4px 8px',
        'text-background-shape': 'roundrectangle',
        'min-zoomed-font-size': 8,
      } as any,
    },
    {
      selector: `node[id="${CLUSTER_ROOT_ID}"]`,
      style: {
        'background-color': '#0f172a',
        'color': '#ffffff',
        'text-background-color': '#0f172a',
        'text-background-opacity': 1,
        'text-valign': 'center',
        'text-margin-y': 0,
        'font-size': '14px',
        'width': 100,
        'height': 100,
      } as any
    },
    {
      selector: 'edge',
      style: {
        'width': 2.5,
        'line-color': '#94a3b8',
        'target-arrow-color': '#94a3b8',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.2,
        'opacity': 0.7,
        'label': (ele: any) => {
          const rel = ele.data('relationshipType') || '';
          return rel.replace(/_/g, ' ');
        },
        'font-size': '10px',
        'font-weight': '500',
        'color': '#64748b',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.9,
        'text-background-padding': '2px 4px',
        'text-background-shape': 'roundrectangle',
        'text-margin-y': -10,
        'min-zoomed-font-size': 9,
      } as any,
    },
    // Heatmap styles
    { selector: 'node.heatmap-green', style: { 'border-color': '#2ECC71', 'border-width': 4 } as any },
    { selector: 'node.heatmap-yellow', style: { 'border-color': '#F39C12', 'border-width': 4 } as any },
    { selector: 'node.heatmap-orange', style: { 'border-color': '#E67E22', 'border-width': 4 } as any },
    { selector: 'node.heatmap-red', style: { 'border-color': '#E74C3C', 'border-width': 4 } as any },
    // Traffic flow
    { selector: 'edge.traffic-flow', style: { 'line-color': '#2ECC71', 'target-arrow-color': '#2ECC71', 'width': 4, 'opacity': 1 } as any },
    // Namespaces (parent nodes if any)
    {
      selector: ':parent',
      style: {
        'text-valign': 'top',
        'text-halign': 'center',
        'background-opacity': 0.05,
        'background-color': '#64748b',
        'border-width': 2,
        'border-color': '#cbd5e1',
        'border-style': 'dashed',
        'padding': 40,
      } as any
    },
    ...getHighlightStylesheet(),
  ];
}

export interface CytoscapeCanvasProps {
  graph: TopologyGraph;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  enabledOverlays?: Set<OverlayType>;
  overlayData?: Map<OverlayType, OverlayData>;
  /** Task 7.2: When set, apply blast radius highlighting with severity gradient */
  blastRadiusResult?: BlastRadiusResult | null;
  /** Context menu action callback (e.g. compute-blast-radius) */
  onContextMenuAction?: (actionId: string, nodeId: string) => void;
  /** Called when blast radius should be cleared (e.g. Escape) */
  onClearBlastRadius?: () => void;
  /** Task 9.5: Called when layout has finished (load time in ms) */
  onLoadTime?: (ms: number) => void;
  /** Heatmap by CPU or restarts (same as Cytoscape Layout tab) */
  heatMapMode?: HeatMapMode;
  /** Animate traffic on routes/exposes/selects edges (same as Cytoscape Layout tab) */
  trafficFlowEnabled?: boolean;
}

/**
 * STABLE ENTERPRISE TOPOLOGY ENGINE
 *
 * Architecture:
 * 1. Cytoscape instance created ONCE - never destroyed except unmount
 * 2. Styles set ONCE - never recalculated
 * 3. Zoom handled by Cytoscape's native transform - we don't touch it
 * 4. Layout runs only on data change - not zoom, not click
 * 5. No state-driven re-renders of graph internals
 */
export const CytoscapeCanvas = forwardRef<EngineRef, CytoscapeCanvasProps>(
  ({ graph, selectedNodeId, onNodeSelect, enabledOverlays = new Set(), overlayData = new Map(), blastRadiusResult = null, onContextMenuAction, onClearBlastRadius, onLoadTime, heatMapMode = 'none', trafficFlowEnabled = false }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<cytoscape.Core | null>(null);
    const highlightManagerRef = useRef<HighlightManager | null>(null);
    const initializedRef = useRef(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const minimapRef = useRef<HTMLDivElement>(null);
    const minimapTransformRef = useRef<{ scale: number; ox: number; oy: number } | null>(null);
    const trafficAnimRef = useRef<number | null>(null);
    const onNodeSelectRef = useRef(onNodeSelect);
    const lastFittedSignatureRef = useRef<string | null>(null);
    const [legendExpanded, setLegendExpanded] = useState(false);
    onNodeSelectRef.current = onNodeSelect;

    // Stable signature so we only re-layout when graph content actually changes (not on every parent re-render).
    // Prevents view jumping and layout flipping when the same graph is passed with a new reference.
    const layoutSignature = React.useMemo(
      () =>
        `${graph.nodes.length}-${graph.edges.length}-${graph.nodes.map((n) => n.id).sort().join(',')}`,
      [graph]
    );

    const updateMinimap = useCallback(() => {
      if (!cyRef.current || !minimapRef.current) return;
      const cy = cyRef.current;
      const canvas = minimapRef.current.querySelector('canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, w, h);
      const bb = cy.elements().boundingBox();
      if (bb.w === 0 || bb.h === 0) return;
      const scale = Math.min(w / bb.w, h / bb.h) * 0.85;
      const ox = (w - bb.w * scale) / 2 - bb.x1 * scale;
      const oy = (h - bb.h * scale) / 2 - bb.y1 * scale;
      minimapTransformRef.current = { scale, ox, oy };
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.5;
      cy.edges().forEach((e: any) => {
        const sp = e.sourceEndpoint();
        const tp = e.targetEndpoint();
        ctx.beginPath();
        ctx.moveTo(sp.x * scale + ox, sp.y * scale + oy);
        ctx.lineTo(tp.x * scale + ox, tp.y * scale + oy);
        ctx.stroke();
      });
      cy.nodes().forEach((n: any) => {
        const pos = n.position();
        const color = n.data('kind') ? (RESOURCE_COLOR_MAP[n.data('kind')] || '#64748b') : '#64748b';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x * scale + ox, pos.y * scale + oy, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      const ext = cy.extent();
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ext.x1 * scale + ox, ext.y1 * scale + oy, ext.w * scale, ext.h * scale);
    }, []);

    // ========================================
    // INITIALIZATION - RUNS ONCE
    // ========================================
    useEffect(() => {
      if (!containerRef.current || initializedRef.current) return;

      const cy = cytoscape({
        container: containerRef.current,
        style: getStaticStyles(),
        layout: { name: 'preset' },
        minZoom: 0.1,
        maxZoom: 3,
        wheelSensitivity: 0.15,
        boxSelectionEnabled: false,
        autoungrabify: false,
      });

      cyRef.current = cy;
      initializedRef.current = true;

      // Initialize highlight manager
      highlightManagerRef.current = new HighlightManager(cy);

      // Node click (use ref so latest parent callback is always invoked)
      cy.on('tap', 'node', (event) => {
        const nodeId = event.target.id();
        onNodeSelectRef.current?.(nodeId);
      });

      // Background click (deselect)
      cy.on('tap', (event) => {
        if (event.target === cy) {
          onNodeSelectRef.current?.(null);
        }
      });

      // Resize: only redraw the canvas, never fit (so user's pan/zoom are preserved)
      const onResize = () => cy.resize();
      window.addEventListener('resize', onResize);

      // Cleanup ONLY on unmount
      return () => {
        window.removeEventListener('resize', onResize);
        cy.destroy();
        cyRef.current = null;
        initializedRef.current = false;
      };
    }, []); // NO dependencies - run once

    // ========================================
    // GRAPH DATA UPDATE – runs only when graph content changes (stable layoutSignature)
    // ========================================
    useEffect(() => {
      if (!cyRef.current || !initializedRef.current) return;

      const cy = cyRef.current;
      const { nodes: hierarchicalNodes, edges: hierarchicalEdges } = buildHierarchicalGraph(graph);
      const nodeCount = hierarchicalNodes.length;

      cy.batch(() => {
        cy.elements().remove();
        cy.add([...hierarchicalNodes, ...hierarchicalEdges]);
      });

      const loadStart = performance.now();
      // Tower preset: positions already set in buildHierarchicalGraph – no overlap, readable hierarchy
      const layout = cy.layout({ name: 'preset', fit: true, padding: 60 });
      layout.run();

      // Only fit when graph actually changed (new filter, new data). Preserves user pan/zoom when parent re-renders.
      layout.one('layoutstop', () => {
        const loadTimeMs = performance.now() - loadStart;
        if (import.meta.env?.DEV) {
          console.log(`[Topology] Load time (layout): ${loadTimeMs.toFixed(0)}ms (${nodeCount} nodes)`);
        }
        onLoadTime?.(loadTimeMs);
        const signatureChanged = lastFittedSignatureRef.current !== layoutSignature;
        lastFittedSignatureRef.current = layoutSignature;
        if (signatureChanged) {
          cy.fit(undefined, 80);
          const z = cy.zoom();
          // If the graph is small, don't over-zoom
          if (z > 1.2) cy.zoom(1.2);
          // If the graph is huge, ensure it's at least readable
          if (z < 0.4) cy.zoom(0.4);
          cy.center();
        }
        updateMinimap();
        cy.resize();

        // Update container height if graph is very long
        if (containerRef.current) {
          const bb = cy.elements().boundingBox();
          const padding = 200;
          const contentHeight = bb.y2 - bb.y1 + padding;
          const parentHeight = containerRef.current.parentElement?.clientHeight || 800;

          if (contentHeight > parentHeight) {
            containerRef.current.style.height = `${contentHeight}px`;
            cy.resize();
          } else {
            containerRef.current.style.height = '100%';
            cy.resize();
          }
        }
      });
    }, [layoutSignature, onLoadTime, updateMinimap]);

    useEffect(() => {
      if (!cyRef.current || !initializedRef.current) return;
      const cy = cyRef.current;
      const handler = () => requestAnimationFrame(updateMinimap);
      cy.on('viewport', handler);
      return () => { cy.off('viewport', handler); };
    }, [updateMinimap]);

    // ========================================
    // HEATMAP (same as Cytoscape Layout tab)
    // ========================================
    useEffect(() => {
      if (!cyRef.current || !initializedRef.current) return;
      const cy = cyRef.current;
      cy.nodes().removeClass('heatmap-green heatmap-yellow heatmap-orange heatmap-red');
      if (enabledOverlays.size > 0 || heatMapMode === 'none') return;
      const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
      let maxVal = 0;
      cy.nodes().forEach((n: any) => {
        const node = nodeMap.get(n.id());
        if (!node?.computed) return;
        const val = heatMapMode === 'cpu'
          ? (node.computed.cpuUsage ?? 0)
          : (node.computed.restartCount ?? 0);
        if (val > maxVal) maxVal = val;
      });
      cy.nodes().forEach((n: any) => {
        const node = nodeMap.get(n.id());
        if (!node?.computed) return;
        const val = heatMapMode === 'cpu'
          ? (node.computed.cpuUsage ?? 0)
          : (node.computed.restartCount ?? 0);
        const color = getHeatmapColor(val, maxVal);
        if (color === '#2ECC71') n.addClass('heatmap-green');
        else if (color === '#F39C12') n.addClass('heatmap-yellow');
        else if (color === '#E67E22') n.addClass('heatmap-orange');
        else n.addClass('heatmap-red');
      });
    }, [graph, heatMapMode, enabledOverlays.size]);

    // ========================================
    // TRAFFIC FLOW ANIMATION (same as Cytoscape Layout tab)
    // ========================================
    useEffect(() => {
      if (!cyRef.current || !initializedRef.current) return;
      const cy = cyRef.current;
      if (trafficAnimRef.current) {
        cancelAnimationFrame(trafficAnimRef.current);
        trafficAnimRef.current = null;
      }
      if (!trafficFlowEnabled) {
        cy.edges().removeClass('traffic-flow');
        return;
      }
      const trafficEdges = cy.edges('[relationshipType="routes"], [relationshipType="exposes"], [relationshipType="selects"]');
      let step = 0;
      function animate() {
        step++;
        const batchSize = Math.ceil(trafficEdges.length / 3) || 1;
        cy.batch(() => {
          trafficEdges.removeClass('traffic-flow');
          const offset = step % 3;
          for (let i = offset * batchSize; i < Math.min((offset + 1) * batchSize, trafficEdges.length); i++) {
            trafficEdges[i]?.addClass('traffic-flow');
          }
        });
        trafficAnimRef.current = requestAnimationFrame(() => setTimeout(animate, 600));
      }
      animate();
      return () => {
        if (trafficAnimRef.current) cancelAnimationFrame(trafficAnimRef.current);
      };
    }, [trafficFlowEnabled]);

    // ========================================
    // SELECTION UPDATE
    // ========================================
    useEffect(() => {
      if (!highlightManagerRef.current) return;

      if (selectedNodeId) {
        highlightManagerRef.current.setSelection(new Set([selectedNodeId]));
      } else {
        highlightManagerRef.current.clearSelection();
      }
    }, [selectedNodeId]);

    // ========================================
    // OVERLAY APPLICATION
    // ========================================
    useEffect(() => {
      if (!cyRef.current || !initializedRef.current) return;

      const cy = cyRef.current;

      // Reset to default colors
      if (enabledOverlays.size === 0) {
        cy.nodes().style('background-color', (ele: any) => {
          const kind = ele.data('kind');
          return RESOURCE_COLOR_MAP[kind] || '#94a3b8';
        });
        return;
      }

      // Apply overlays
      enabledOverlays.forEach((overlayType) => {
        const data = overlayData.get(overlayType);
        if (!data) return;

        data.nodeValues.forEach((value, nodeId) => {
          const node = cy.getElementById(nodeId);
          if (!node.empty()) {
            const color = getOverlayColor(overlayType, value);
            node.style('background-color', color);
          }
        });

        if (data.edgeValues) {
          data.edgeValues.forEach((value, edgeKey) => {
            const edges = cy.edges().filter((ele) => {
              const s = ele.source().id();
              const t = ele.target().id();
              return `${s}-${t}` === edgeKey;
            });

            if (!edges.empty()) {
              const color = getOverlayColor(overlayType, value);
              edges.style({
                'line-color': color,
                'target-arrow-color': color,
                width: 2 + (value / 100) * 3,
              });
            }
          });
        }
      });
    }, [enabledOverlays, overlayData]);

    // ========================================
    // BLAST RADIUS (Task 7.2) – severity gradient
    // ========================================
    useEffect(() => {
      if (!cyRef.current || !highlightManagerRef.current) return;

      const cy = cyRef.current;
      const hm = highlightManagerRef.current;

      if (!blastRadiusResult) {
        hm.clearBlastRadius();
        cy.nodes().style('background-color', (ele: any) => RESOURCE_COLOR_MAP[ele.data('kind')] || '#94a3b8');
        return;
      }

      const { affectedNodes, affectedEdges, severity } = blastRadiusResult;
      hm.setBlastRadius(new Set(affectedNodes), new Set(affectedEdges));

      affectedNodes.forEach((nodeId) => {
        const node = cy.getElementById(nodeId);
        if (!node.empty()) {
          const score = severity.get(nodeId) ?? 0;
          node.style('background-color', getBlastRadiusColor(score));
        }
      });
    }, [blastRadiusResult]);

    // ========================================
    // KEYBOARD SHORTCUTS
    // ========================================
    useEffect(() => {
      if (!cyRef.current) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        const cy = cyRef.current;
        if (!cy) return;

        // Ignore if user is typing in an input or textarea
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return;
        }

        switch (e.key.toLowerCase()) {
          case 'f':
            // F: Fit graph to screen
            e.preventDefault();
            cy.fit(undefined, 60);
            break;

          case 'r':
            // R: Reset view (zoom 1.0, center)
            e.preventDefault();
            cy.zoom(1);
            cy.center();
            break;

          case ' ':
            // Space: Pause/Resume auto-refresh (would need parent state)
            e.preventDefault();
            console.log('Pause/Resume auto-refresh - requires parent implementation');
            break;

          case 'escape':
            // Escape: Deselect nodes and clear blast radius
            e.preventDefault();
            onNodeSelect?.(null);
            onClearBlastRadius?.();
            if (highlightManagerRef.current) {
              highlightManagerRef.current.clearSelection();
            }
            break;

          case '+':
          case '=':
            // +: Zoom in
            e.preventDefault();
            cy.zoom(cy.zoom() * 1.2);
            cy.center();
            break;

          case '-':
          case '_':
            // -: Zoom out
            e.preventDefault();
            cy.zoom(cy.zoom() / 1.2);
            cy.center();
            break;

          case 'arrowup':
            // Arrow Up: Pan up
            e.preventDefault();
            cy.panBy({ x: 0, y: 50 });
            break;

          case 'arrowdown':
            // Arrow Down: Pan down
            e.preventDefault();
            cy.panBy({ x: 0, y: -50 });
            break;

          case 'arrowleft':
            // Arrow Left: Pan left
            e.preventDefault();
            cy.panBy({ x: 50, y: 0 });
            break;

          case 'arrowright':
            // Arrow Right: Pan right
            e.preventDefault();
            cy.panBy({ x: -50, y: 0 });
            break;
        }

        // Cmd/Ctrl+F: Focus search input (Task 4.7)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [onNodeSelect, onClearBlastRadius]);

    // ========================================
    // IMPERATIVE API
    // ========================================
    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        if (cyRef.current) {
          cyRef.current.zoom(cyRef.current.zoom() * 1.2);
          cyRef.current.center();
        }
      },

      zoomOut: () => {
        if (cyRef.current) {
          cyRef.current.zoom(cyRef.current.zoom() / 1.2);
          cyRef.current.center();
        }
      },

      fitToScreen: () => {
        cyRef.current?.fit(undefined, 60);
      },

      resetView: () => {
        if (cyRef.current) {
          cyRef.current.zoom(1);
          cyRef.current.center();
        }
      },

      exportAsSVG: () => {
        if (!cyRef.current) return undefined;
        const cy = cyRef.current;
        const svgExport = (cy as any).svg;
        if (typeof svgExport !== 'function') return undefined;
        const originalZoom = cy.zoom();
        cy.elements().removeClass('hovered highlighted faded selected');
        cy.fit(undefined, 100);
        const svgContent = svgExport.call(cy, { full: true, scale: 1, bg: '#ffffff' });
        cy.zoom(originalZoom);
        cy.center();
        return typeof svgContent === 'string' ? svgContent : undefined;
      },

      exportAsPNG: () => {
        if (!cyRef.current) return undefined;

        const cy = cyRef.current;
        const originalZoom = cy.zoom();

        // Clean state for export
        cy.elements().removeClass('hovered highlighted faded selected');

        // Fit with padding
        cy.fit(undefined, 100);

        // Task 9.7: Measure PNG export time
        if (import.meta.env?.DEV) {
          console.time('PNG Export');
        }
        const png = cy.png({
          output: 'base64uri',
          scale: 5,
          full: true,
          bg: '#ffffff',
        });
        if (import.meta.env?.DEV) {
          console.timeEnd('PNG Export');
        }

        // Restore view
        cy.zoom(originalZoom);
        cy.center();

        return png;
      },

      relayout: () => {
        cyRef.current?.fit(undefined, 60);
      },

      getNodeCount: () => cyRef.current?.nodes().length ?? 0,
      getEdgeCount: () => cyRef.current?.edges().length ?? 0,
      setOverlay: () => { },
      selectNode: (nodeId: string) => { onNodeSelectRef.current?.(nodeId); },
      clearSelection: () => { onNodeSelectRef.current?.(null); },
    }));

    return (
      <div className="relative w-full h-full bg-white">
        {/* SEARCH TOOLBAR */}
        {cyRef.current && highlightManagerRef.current && (
          <div className="absolute top-6 left-6 right-6 z-20">
            <TopologySearch
              cy={cyRef.current}
              highlightManager={highlightManagerRef.current}
              searchInputRef={searchInputRef}
            />
          </div>
        )}

        {/* FIXED HEIGHT CONTAINER - PURE WHITE BACKGROUND */}
        <div
          ref={containerRef}
          className="relative bg-white transition-[height] duration-300"
          style={{
            width: '100%',
            height: '100%',
            minHeight: '800px',
            backgroundColor: '#ffffff',
          }}
        />

        <script>
          {/* We add a effect to handle dynamic height if needed */}
        </script>

        {/* LEGEND - Collapsible so topology has full height; expand when needed */}
        <div
          className={`absolute left-6 right-6 z-10 bg-white rounded-t-xl border-2 border-b-0 border-slate-800 shadow-2xl transition-all duration-200 ${legendExpanded ? 'bottom-0 max-h-[40vh] overflow-y-auto' : 'bottom-0 h-auto'
            }`}
        >
          <button
            type="button"
            onClick={() => setLegendExpanded((e) => !e)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 text-left hover:bg-slate-50 rounded-t-xl border-b border-slate-200"
            aria-expanded={legendExpanded}
          >
            <span className="text-sm font-bold text-slate-900 uppercase tracking-wider">Resource types</span>
            <span className="text-slate-500 text-xs" aria-hidden>{legendExpanded ? '▼ Collapse' : '▲ Expand'}</span>
          </button>
          {legendExpanded && (
            <div className="px-6 py-4 flex items-center gap-6 flex-wrap justify-center">
              {Object.entries(RESOURCE_COLOR_MAP).map(([kind, color]) => (
                <div key={kind} className="flex items-center gap-2 shrink-0">
                  <div className="w-3.5 h-3.5 rounded border border-slate-700" style={{ backgroundColor: color }} />
                  <span className="text-xs font-semibold text-slate-800">{kind}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CONTEXT MENU */}
        {cyRef.current && (
          <ContextMenu
            cy={cyRef.current}
            onAction={(action, nodeId) => onContextMenuAction?.(action, nodeId)}
          />
        )}

        {/* HOVER TOOLTIP */}
        {cyRef.current && (
          <HoverTooltip
            cy={cyRef.current}
            onViewDetails={(nodeId) => onNodeSelect?.(nodeId)}
            onViewLogs={(nodeId) => { }}
          />
        )}

        {/* MINIMAP (same as Cytoscape Layout tab – click to pan) */}
        <div
          ref={minimapRef}
          className="absolute bottom-4 right-4 w-[160px] h-[100px] rounded-lg border border-border bg-background/90 backdrop-blur-sm shadow-lg overflow-hidden cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label="Minimap – click to pan view"
          onClick={(e) => {
            if (!cyRef.current || !minimapRef.current || !minimapTransformRef.current) return;
            const canvas = minimapRef.current.querySelector('canvas');
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const { scale, ox, oy } = minimapTransformRef.current;
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const graphX = (clickX - ox) / scale;
            const graphY = (clickY - oy) / scale;
            const cy = cyRef.current;
            const zoom = cy.zoom();
            const container = containerRef.current;
            const cw = container?.clientWidth ?? 400;
            const ch = container?.clientHeight ?? 300;
            cy.pan({ x: -graphX * zoom + cw / 2, y: -graphY * zoom + ch / 2 });
          }}
        >
          <canvas width={160} height={100} className="w-full h-full block" />
          <div className="absolute top-1 left-1.5 text-[8px] font-semibold text-muted-foreground/60 uppercase tracking-wider pointer-events-none">
            Minimap
          </div>
        </div>
      </div>
    );
  }
);

CytoscapeCanvas.displayName = 'CytoscapeCanvas';

/** Task 7.2: Blast radius severity gradient */
function getBlastRadiusColor(severity: number): string {
  if (severity > 75) return '#ef4444';
  if (severity > 50) return '#f97316';
  if (severity > 25) return '#fb923c';
  return '#fbbf24';
}

/**
 * OVERLAY COLOR MAPPING
 */
function getOverlayColor(overlayType: OverlayType, value: number): string {
  switch (overlayType) {
    case 'health':
      // Task 5.1: healthy | warning | critical | unknown (HealthOverlay uses 100|50|0|25)
      if (value >= 80) return '#10b981';
      if (value >= 40) return '#f59e0b';
      if (value === 25) return '#94a3b8'; // unknown
      return '#ef4444'; // critical
    case 'cost':
      return value < 20 ? '#10b981' : value < 50 ? '#84cc16' : value < 80 ? '#f97316' : '#ef4444';
    case 'security':
      return value > 80 ? '#10b981' : value > 50 ? '#eab308' : value > 20 ? '#f97316' : '#ef4444';
    case 'performance':
      return value < 20 ? '#3b82f6' : value < 50 ? '#10b981' : value < 80 ? '#f97316' : '#ef4444';
    case 'dependency':
      return value < 20 ? '#3b82f6' : value < 50 ? '#10b981' : value < 80 ? '#f97316' : '#ef4444';
    case 'traffic':
      return value < 20 ? '#93c5fd' : value < 50 ? '#60a5fa' : value < 80 ? '#3b82f6' : '#1e40af';
    default:
      return '#94a3b8';
  }
}
