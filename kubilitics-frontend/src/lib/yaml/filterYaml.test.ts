import { describe, it, expect } from 'vitest';
import { filterYaml } from './filterYaml';

describe('filterYaml', () => {
  it("'raw' returns input unchanged (reference equality)", () => {
    const input = { kind: 'Pod', metadata: { managedFields: [1, 2, 3] } };
    expect(filterYaml(input, 'raw')).toBe(input);
  });

  it("'clean' removes metadata.managedFields", () => {
    const input = {
      kind: 'Pod',
      metadata: {
        name: 'p',
        managedFields: [{ manager: 'kubelet' }],
      },
    };
    const out = filterYaml(input, 'clean') as { metadata: Record<string, unknown> };
    expect(out.metadata).not.toHaveProperty('managedFields');
    expect(out.metadata.name).toBe('p');
  });

  it("'clean' is a no-op when managedFields is absent", () => {
    const input = { kind: 'Pod', metadata: { name: 'p' } };
    const out = filterYaml(input, 'clean') as { metadata: Record<string, unknown> };
    expect(out.metadata).toEqual({ name: 'p' });
  });

  it("'clean' keeps status, spec, and other metadata fields intact", () => {
    const input = {
      kind: 'Pod',
      apiVersion: 'v1',
      metadata: {
        name: 'p',
        namespace: 'default',
        uid: 'abc-123',
        resourceVersion: '42',
        generation: 1,
        creationTimestamp: '2026-04-16T00:00:00Z',
        managedFields: [{ manager: 'kubelet' }],
        labels: { app: 'x' },
      },
      spec: { containers: [{ name: 'c', image: 'nginx' }] },
      status: { phase: 'Running', podIP: '10.0.0.1' },
    };
    const out = filterYaml(input, 'clean') as typeof input;
    expect(out.kind).toBe('Pod');
    expect(out.apiVersion).toBe('v1');
    expect(out.spec).toEqual(input.spec);
    expect(out.status).toEqual(input.status);
    expect(out.metadata.name).toBe('p');
    expect(out.metadata.namespace).toBe('default');
    expect(out.metadata.uid).toBe('abc-123');
    expect(out.metadata.resourceVersion).toBe('42');
    expect(out.metadata.generation).toBe(1);
    expect(out.metadata.creationTimestamp).toBe('2026-04-16T00:00:00Z');
    expect(out.metadata.labels).toEqual({ app: 'x' });
  });

  it('does not mutate its input when filtering', () => {
    const input = {
      kind: 'Pod',
      metadata: {
        name: 'p',
        managedFields: [{ manager: 'kubelet' }],
      },
    };
    const snapshot = JSON.stringify(input);
    filterYaml(input, 'clean');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles missing or non-object metadata gracefully', () => {
    expect(filterYaml({ kind: 'Pod' }, 'clean')).toEqual({ kind: 'Pod' });
    expect(filterYaml({ kind: 'Pod', metadata: null }, 'clean')).toEqual({
      kind: 'Pod',
      metadata: null,
    });
  });

  it('passes null, undefined, and primitives through unchanged', () => {
    expect(filterYaml(null, 'clean')).toBe(null);
    expect(filterYaml(undefined, 'clean')).toBe(undefined);
    expect(filterYaml('string', 'clean')).toBe('string');
    expect(filterYaml(42, 'clean')).toBe(42);
  });
});
