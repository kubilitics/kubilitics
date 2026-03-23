import { memo } from "react";
import k8sIconMap from "./k8sIconMap";

interface K8sIconProps {
  /** Kubernetes resource kind (e.g. "Pod", "Deployment", "Service") */
  kind: string;
  /** Icon size in pixels (default: 20) */
  size?: number;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Renders an official Kubernetes community SVG icon for the given resource kind.
 * Falls back to a generic diamond icon if no matching SVG exists.
 */
function K8sIconInner({ kind, size = 20, className }: K8sIconProps) {
  const url = k8sIconMap[kind.toLowerCase()];

  if (!url) {
    // Fallback: colored diamond for unknown kinds
    return (
      <span
        className={className}
        style={{ fontSize: size, lineHeight: 1 }}
        aria-hidden="true"
      >
        🔷
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}

export const K8sIcon = memo(K8sIconInner);
