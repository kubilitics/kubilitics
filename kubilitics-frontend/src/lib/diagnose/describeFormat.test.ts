import { describe, it, expect } from 'vitest';
import { toDescribeText } from './describeFormat';
import { diagnosePod } from './podDiagnosis';
import { crashLoopPod, healthyPod, warningEvent } from './__fixtures__/fixtures';

describe('toDescribeText', () => {
  it('includes kind, namespace, name, severity, headline', () => {
    const pod = crashLoopPod('my-pod');
    const d = diagnosePod(pod, [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      warningEvent('BackOff', 'Back-off restarting failed container', 7) as any,
    ]);
    const text = toDescribeText(d, pod);

    expect(text).toContain('Kubilitics Diagnose');
    expect(text).toContain('default/my-pod');
    expect(text).toContain('Kind:');
    expect(text).toContain('Pod');
    expect(text).toContain('Severity:');
    expect(text).toContain('BROKEN');
    expect(text).toContain('Headline:');
    expect(text.toLowerCase()).toContain('crash');
  });

  it('includes last terminated details for broken pods', () => {
    const d = diagnosePod(crashLoopPod());
    const text = toDescribeText(d, crashLoopPod());
    expect(text).toContain('Last State');
    expect(text).toContain('StartError');
    expect(text).toContain('128');
    expect(text).toContain('invalid-command');
  });

  it('includes recent warnings section with full message', () => {
    const d = diagnosePod(crashLoopPod(), [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      warningEvent('BackOff', 'Back-off restarting failed container busybox', 7) as any,
    ]);
    const text = toDescribeText(d, crashLoopPod());
    expect(text).toContain('Recent Warnings');
    expect(text).toContain('Back-off restarting failed container busybox');
  });

  it('healthy pod produces a short summary', () => {
    const d = diagnosePod(healthyPod());
    const text = toDescribeText(d, healthyPod());
    expect(text).toContain('HEALTHY');
    expect(text).toContain('Kubilitics Diagnose');
    expect(text).not.toContain('Last State:');
  });

  it('is a stable string (no timestamps inside body)', () => {
    const pod = crashLoopPod();
    const d1 = diagnosePod(pod);
    const d2 = diagnosePod(pod);
    const stripFirstFiveLines = (s: string) => s.split('\n').slice(5).join('\n');
    expect(stripFirstFiveLines(toDescribeText(d1, pod))).toBe(stripFirstFiveLines(toDescribeText(d2, pod)));
  });
});
