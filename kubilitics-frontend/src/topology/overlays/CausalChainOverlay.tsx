/* eslint-disable react-refresh/only-export-components */
import type React from 'react';
import type { CausalChain } from '@/stores/causalChainStore';

/**
 * Returns the chain step index for a node. -1 if not in chain.
 * Step 0 = root cause (first link's cause), Step N = Nth link's effect.
 */
export function getChainStepIndex(nodeId: string, chain: CausalChain): number {
  if (chain.links.length > 0 && chain.links[0].cause.resourceKey === nodeId) {
    return 0;
  }
  for (let i = 0; i < chain.links.length; i++) {
    if (chain.links[i].effect.resourceKey === nodeId) {
      return i + 1;
    }
  }
  return -1;
}

export function isInChain(nodeId: string, chain: CausalChain): boolean {
  return getChainStepIndex(nodeId, chain) >= 0;
}

/**
 * Step badge color: amber (root) → orange (middle) → red (symptom)
 */
export function getStepBadgeColor(stepIndex: number, totalSteps: number): string {
  if (totalSteps <= 1) return 'bg-amber-500';
  const ratio = stepIndex / (totalSteps - 1);
  if (ratio <= 0.33) return 'bg-amber-500';
  if (ratio <= 0.66) return 'bg-orange-500';
  return 'bg-red-500';
}

/**
 * Tailwind classes for chain nodes. Non-chain nodes get empty string
 * (dimming is handled via inline styles).
 */
export function getCausalChainNodeClassName(
  nodeId: string,
  chain: CausalChain,
  highlightedStep: number | null
): string {
  const stepIndex = getChainStepIndex(nodeId, chain);
  if (stepIndex < 0) return 'rounded-lg';
  if (stepIndex === 0) {
    return 'ring-[3px] ring-amber-500 dark:ring-amber-400 rounded-lg shadow-[0_0_20px_rgba(245,158,11,0.4)]';
  }
  const ratio = stepIndex / chain.links.length;
  if (ratio <= 0.5) {
    return 'ring-2 ring-orange-500 dark:ring-orange-400 rounded-lg shadow-[0_0_12px_rgba(249,115,22,0.3)]';
  }
  return 'ring-2 ring-red-500 dark:ring-red-400 rounded-lg shadow-[0_0_12px_rgba(239,68,68,0.3)]';
}

/**
 * Inline styles for chain nodes. Non-chain nodes get dimmed (same as blast radius).
 */
export function getCausalChainNodeStyle(
  nodeId: string,
  chain: CausalChain,
  highlightedStep: number | null
): React.CSSProperties {
  const stepIndex = getChainStepIndex(nodeId, chain);
  if (stepIndex < 0) {
    return { opacity: 0.15, filter: 'saturate(0.2)', transition: 'opacity 0.15s' };
  }
  const isHighlighted = highlightedStep !== null && stepIndex === highlightedStep;
  return {
    zIndex: isHighlighted ? 100 : 50,
    transition: 'opacity 0.15s',
    ...(isHighlighted ? { transform: 'scale(1.03)' } : {}),
  };
}

/**
 * Returns set of resource keys in the chain (for edge highlighting).
 */
export function getChainResourceKeys(chain: CausalChain): Set<string> {
  const keys = new Set<string>();
  for (const link of chain.links) {
    keys.add(link.cause.resourceKey);
    keys.add(link.effect.resourceKey);
  }
  return keys;
}
