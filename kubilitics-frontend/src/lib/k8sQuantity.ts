/**
 * Canonical parsers for Kubernetes resource quantity strings (CPU, memory).
 *
 * METRICS-2 (docs/PRODUCTION-RELIABILITY-AUDIT.md): before this module
 * existed, ~6 independent hand-rolled parsers across the frontend each
 * reimplemented this logic, several silently coercing invalid/missing input
 * to 0 (`parseFloat(x) || 0`-style) instead of signaling "unknown." That
 * decoupling is exactly how a page can show a corrupted/huge total memory
 * value while its percentage independently falls back to "0% used" — the
 * numerator and percentage paths fail independently instead of together.
 *
 * Both parsers return `null` — never `NaN`, never a silently-substituted 0 —
 * on missing or unparseable input, so callers can render an explicit
 * "unknown" state instead of a confidently-wrong number.
 */

const MEMORY_UNIT_MULTIPLIERS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
  K: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  T: 1000 ** 4,
  P: 1000 ** 5,
  E: 1000 ** 6,
};

// Longest-suffix-first so "Ki" matches before a hypothetical bare "K" check
// order issue, and so the regex below is unambiguous.
const MEMORY_UNIT_SUFFIXES = Object.keys(MEMORY_UNIT_MULTIPLIERS).sort((a, b) => b.length - a.length);
const MEMORY_PATTERN = new RegExp(`^(-?\\d+(?:\\.\\d+)?)(${MEMORY_UNIT_SUFFIXES.join('|')})?$`);

/**
 * Parse a Kubernetes memory quantity string (e.g. "256Mi", "1Gi", "512Ki",
 * "1073741824", "128M") into bytes. Returns null — not 0, not NaN — for
 * missing, empty, "-", or unparseable input, and for negative values (memory
 * can't be negative; a negative value indicates upstream corruption, not a
 * valid reading).
 */
export function parseK8sQuantityToBytes(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? input : null;
  }
  const s = input.trim();
  if (s === '' || s === '-') return null;

  const match = MEMORY_PATTERN.exec(s);
  if (!match) return null;

  const value = Number.parseFloat(match[1]!);
  if (!Number.isFinite(value) || value < 0) return null;

  const unit = match[2];
  const multiplier = unit ? MEMORY_UNIT_MULTIPLIERS[unit] : 1;
  const bytes = value * (multiplier ?? 1);
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * Parse a Kubernetes CPU quantity string (e.g. "250m", "1", "1.5",
 * "500000000n", "1500u") into millicores. Returns null for missing, empty,
 * "-", unparseable, or negative input.
 */
export function parseK8sCpuToMillicores(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? input * 1000 : null;
  }
  const s = input.trim();
  if (s === '' || s === '-') return null;

  let numericPart = s;
  let scale = 1000; // bare number = whole cores -> millicores
  if (s.endsWith('m')) {
    numericPart = s.slice(0, -1);
    scale = 1;
  } else if (s.endsWith('u') || s.endsWith('µ')) {
    numericPart = s.slice(0, -1);
    scale = 1 / 1000;
  } else if (s.endsWith('n')) {
    numericPart = s.slice(0, -1);
    scale = 1 / 1_000_000;
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(numericPart)) return null;
  const value = Number.parseFloat(numericPart);
  if (!Number.isFinite(value) || value < 0) return null;

  const millicores = value * scale;
  return Number.isFinite(millicores) ? millicores : null;
}
