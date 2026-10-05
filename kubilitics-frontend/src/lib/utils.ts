import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { parseK8sQuantityToBytes } from "@/lib/k8sQuantity";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseCpu(cpu: string): number {
  if (!cpu) return 0;
  if (cpu.endsWith('m')) return parseInt(cpu, 10);
  return parseFloat(cpu) * 1000;
}

// METRICS-2 (docs/PRODUCTION-RELIABILITY-AUDIT.md): previously had no guard
// against invalid input — a malformed memory string produced NaN, which then
// poisoned any running sum it was added to (NaN + x = NaN for the rest of the
// aggregate, potentially rendering as literal "NaN" in the UI). Delegates to
// the canonical parser and keeps this function's existing `number` contract
// for its callers by substituting 0 only here, at the boundary — callers
// that need to distinguish "known zero" from "unknown" should call
// parseK8sQuantityToBytes directly instead.
export function parseMemory(memory: string): number {
  return parseK8sQuantityToBytes(memory) ?? 0;
}
