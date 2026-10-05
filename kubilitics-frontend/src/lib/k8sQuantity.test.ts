import { describe, it, expect } from 'vitest';
import { parseK8sQuantityToBytes, parseK8sCpuToMillicores } from './k8sQuantity';

describe('parseK8sQuantityToBytes', () => {
  it('returns null for null/undefined/empty/missing', () => {
    expect(parseK8sQuantityToBytes(null)).toBeNull();
    expect(parseK8sQuantityToBytes(undefined)).toBeNull();
    expect(parseK8sQuantityToBytes('')).toBeNull();
    expect(parseK8sQuantityToBytes('-')).toBeNull();
    expect(parseK8sQuantityToBytes('  ')).toBeNull();
  });

  it('parses zero correctly (distinct from unknown)', () => {
    expect(parseK8sQuantityToBytes('0')).toBe(0);
    expect(parseK8sQuantityToBytes('0Mi')).toBe(0);
  });

  it('parses small, normal, and large binary values', () => {
    expect(parseK8sQuantityToBytes('512Ki')).toBe(512 * 1024);
    expect(parseK8sQuantityToBytes('256Mi')).toBe(256 * 1024 * 1024);
    expect(parseK8sQuantityToBytes('4Gi')).toBe(4 * 1024 ** 3);
    expect(parseK8sQuantityToBytes('2Ti')).toBe(2 * 1024 ** 4);
  });

  it('parses decimal (non-binary) units', () => {
    expect(parseK8sQuantityToBytes('100M')).toBe(100 * 1000 ** 2);
    expect(parseK8sQuantityToBytes('1G')).toBe(1000 ** 3);
  });

  it('parses bare numbers as raw bytes', () => {
    expect(parseK8sQuantityToBytes('1073741824')).toBe(1073741824);
  });

  it('parses a numeric input directly', () => {
    expect(parseK8sQuantityToBytes(2048)).toBe(2048);
  });

  it('parses maximum realistic values without overflow/precision loss', () => {
    // A very large but realistic cluster-wide total (e.g. 10 PiB).
    expect(parseK8sQuantityToBytes('10Pi')).toBe(10 * 1024 ** 5);
  });

  it('returns null for invalid/garbage input', () => {
    expect(parseK8sQuantityToBytes('not-a-number')).toBeNull();
    expect(parseK8sQuantityToBytes('32Zz')).toBeNull();
    expect(parseK8sQuantityToBytes('Mi256')).toBeNull();
  });

  // METRICS-2 (docs/PRODUCTION-RELIABILITY-AUDIT.md) Test Coverage Gap
  // (Phase 9, docs/PRODUCTION-HARDENING-ROADMAP.md): scientific-notation
  // quantity strings were never fed through this parser in a test. The
  // MEMORY_PATTERN regex has no exponent group, so this input fails to
  // match and correctly falls through to null (unknown) — never silently
  // misparsed as a small number (e.g. treating "1e9" as "1").
  it('returns null for scientific-notation input (not silently misparsed)', () => {
    expect(parseK8sQuantityToBytes('1.5e9')).toBeNull();
    expect(parseK8sQuantityToBytes('1E9')).toBeNull();
    expect(parseK8sQuantityToBytes('2e3Mi')).toBeNull();
  });

  it('returns null for negative values (memory cannot be negative)', () => {
    expect(parseK8sQuantityToBytes('-256Mi')).toBeNull();
    expect(parseK8sQuantityToBytes(-100)).toBeNull();
  });

  it('returns null for NaN and non-finite numeric input', () => {
    expect(parseK8sQuantityToBytes(NaN)).toBeNull();
    expect(parseK8sQuantityToBytes(Infinity)).toBeNull();
    expect(parseK8sQuantityToBytes(-Infinity)).toBeNull();
  });
});

describe('parseK8sCpuToMillicores', () => {
  it('returns null for null/undefined/empty/missing', () => {
    expect(parseK8sCpuToMillicores(null)).toBeNull();
    expect(parseK8sCpuToMillicores(undefined)).toBeNull();
    expect(parseK8sCpuToMillicores('')).toBeNull();
    expect(parseK8sCpuToMillicores('-')).toBeNull();
  });

  it('parses zero correctly', () => {
    expect(parseK8sCpuToMillicores('0')).toBe(0);
    expect(parseK8sCpuToMillicores('0m')).toBe(0);
  });

  it('parses millicores, whole cores, and fractional cores', () => {
    expect(parseK8sCpuToMillicores('250m')).toBe(250);
    expect(parseK8sCpuToMillicores('1')).toBe(1000);
    expect(parseK8sCpuToMillicores('1.5')).toBe(1500);
  });

  it('parses microcores and nanocores', () => {
    expect(parseK8sCpuToMillicores('1500u')).toBeCloseTo(1.5, 5);
    expect(parseK8sCpuToMillicores('500000000n')).toBeCloseTo(500, 5);
  });

  it('parses large realistic values (64-core node)', () => {
    expect(parseK8sCpuToMillicores('64')).toBe(64000);
  });

  it('returns null for invalid/garbage input', () => {
    expect(parseK8sCpuToMillicores('not-a-number')).toBeNull();
    expect(parseK8sCpuToMillicores('500x')).toBeNull();
  });

  // METRICS-2 (docs/PRODUCTION-RELIABILITY-AUDIT.md) Test Coverage Gap
  // (Phase 9): same reasoning as parseK8sQuantityToBytes above — the
  // numeric-part regex has no exponent group, so scientific notation
  // correctly falls through to null rather than being misparsed.
  it('returns null for scientific-notation input (not silently misparsed)', () => {
    expect(parseK8sCpuToMillicores('1.5e3')).toBeNull();
    expect(parseK8sCpuToMillicores('2E3m')).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(parseK8sCpuToMillicores('-250m')).toBeNull();
    expect(parseK8sCpuToMillicores(-1)).toBeNull();
  });

  it('returns null for NaN and non-finite numeric input', () => {
    expect(parseK8sCpuToMillicores(NaN)).toBeNull();
    expect(parseK8sCpuToMillicores(Infinity)).toBeNull();
  });
});
