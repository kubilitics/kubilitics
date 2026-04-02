/**
 * DiffEdge — Custom React Flow edge for topology diff visualization.
 *
 * Renders edges with diff-aware styling:
 * - Added:     green stroke, animated dash pattern
 * - Removed:   red stroke, static dash
 * - Changed:   yellow/orange stroke, "~" label
 * - Unchanged: default with low opacity (dimmed)
 */
import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export type DiffEdgeStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffEdgeData {
  diffStatus: DiffEdgeStatus;
  label?: string;
  [key: string]: unknown;
}

const DIFF_EDGE_STYLES: Record<DiffEdgeStatus, {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  animated: boolean;
  opacity: number;
}> = {
  added: {
    stroke: "#22c55e",     // green-500
    strokeWidth: 2.5,
    strokeDasharray: "8 4",
    animated: true,
    opacity: 1,
  },
  removed: {
    stroke: "#ef4444",     // red-500
    strokeWidth: 2,
    strokeDasharray: "6 4",
    animated: false,
    opacity: 0.85,
  },
  changed: {
    stroke: "#f59e0b",     // amber-500
    strokeWidth: 2.5,
    strokeDasharray: undefined,
    animated: false,
    opacity: 1,
  },
  unchanged: {
    stroke: "#94a3b8",     // slate-400
    strokeWidth: 1,
    strokeDasharray: undefined,
    animated: false,
    opacity: 0.3,
  },
};

function DiffEdgeInner(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
  } = props;

  const d = data as DiffEdgeData | undefined;
  const status = d?.diffStatus ?? 'unchanged';
  const style = DIFF_EDGE_STYLES[status];

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          strokeDasharray: style.strokeDasharray,
          opacity: style.opacity,
          animation: style.animated ? "diff-dash-flow 1s linear infinite" : undefined,
        }}
      />
      {/* Label for changed and added/removed edges */}
      {(status === 'changed' || d?.label) && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: labelX, top: labelY }}
          >
            <span
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold shadow-sm backdrop-blur-sm"
              style={{
                borderColor: style.stroke,
                color: style.stroke,
                backgroundColor: status === 'changed'
                  ? 'rgba(245, 158, 11, 0.1)'
                  : status === 'added'
                    ? 'rgba(34, 197, 94, 0.1)'
                    : status === 'removed'
                      ? 'rgba(239, 68, 68, 0.1)'
                      : 'rgba(148, 163, 184, 0.1)',
              }}
            >
              {status === 'changed' && "~"}
              {d?.label && ` ${d.label}`}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
      <style>{`
        @keyframes diff-dash-flow {
          to { stroke-dashoffset: -12; }
        }
      `}</style>
    </>
  );
}

export const DiffEdge = memo(DiffEdgeInner);
