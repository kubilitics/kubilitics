/**
 * Escapes all special regex metacharacters in a string so it can be safely
 * used inside `new RegExp(...)` without ReDoS risk.
 *
 * Based on the MDN-recommended escape pattern.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions#escaping
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
