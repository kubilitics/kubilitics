import { describe, it, expect } from 'vitest';
import { REASONS, lookupReason } from './reasons';

describe('REASONS table', () => {
  it('has no rows with empty title or explanation', () => {
    for (const [code, reason] of Object.entries(REASONS)) {
      expect(reason.code, `code for ${code}`).toBe(code);
      expect(reason.title.length, `title for ${code}`).toBeGreaterThan(0);
      expect(reason.explanation.length, `explanation for ${code}`).toBeGreaterThan(0);
      expect(reason.suggestions.length, `suggestions for ${code}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('all severities are valid enum values', () => {
    const allowed = ['healthy', 'degraded', 'broken', 'unknown'];
    for (const [code, reason] of Object.entries(REASONS)) {
      expect(allowed, `severity for ${code}`).toContain(reason.severity);
    }
  });

  it('has the key reason codes operators expect', () => {
    const required = [
      'CrashLoopBackOff',
      'ImagePullBackOff',
      'ErrImagePull',
      'OOMKilled',
      'CreateContainerConfigError',
      'Evicted',
      'DeadlineExceeded',
      'FailedScheduling',
      'PodInitializing',
      'ContainerCreating',
      'Completed',
      'StartError',
      'ContainerCannotRun',
    ];
    for (const code of required) {
      expect(REASONS[code], `missing reason: ${code}`).toBeDefined();
    }
  });

  it('all suggestion texts are non-empty', () => {
    for (const [code, reason] of Object.entries(REASONS)) {
      for (const sug of reason.suggestions) {
        expect(sug.text.length, `suggestion text for ${code}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('lookupReason', () => {
  it('returns the exact match when present', () => {
    const r = lookupReason('CrashLoopBackOff');
    expect(r.code).toBe('CrashLoopBackOff');
    expect(r.severity).toBe('broken');
  });

  it('returns a generic fallback for unknown codes', () => {
    const r = lookupReason('NeverSeenReason');
    expect(r.code).toBe('NeverSeenReason');
    expect(r.title.toLowerCase()).toContain('unknown');
  });

  it('empty input returns an unknown fallback', () => {
    const r = lookupReason(undefined);
    expect(r.severity).toBe('unknown');
  });
});
