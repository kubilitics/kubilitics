// src/lib/rootCauseHeuristic.ts

interface RootCauseResult {
  cause: string;
  keyword: string | null;
}

const PATTERNS: Array<{ regex: RegExp; template: (m: RegExpMatchArray) => string; keyword: string }> = [
  {
    regex: /connection refused.*?(\S+:\d+)/i,
    template: (m) => `Connection failure to ${m[1]}`,
    keyword: 'connection refused',
  },
  {
    regex: /OOMKilled/i,
    template: () => 'Container exceeded memory limit (OOMKilled)',
    keyword: 'OOMKilled',
  },
  {
    regex: /ImagePullBackOff|ErrImagePull|image.*not found/i,
    template: () => 'Container image pull failed',
    keyword: 'ImagePullBackOff',
  },
  {
    regex: /CrashLoopBackOff/i,
    template: () => 'Container crashing repeatedly on startup',
    keyword: 'CrashLoopBackOff',
  },
  {
    regex: /panic:\s*(.{0,80})/i,
    template: (m) => `Application crash: ${m[1]}`,
    keyword: 'panic',
  },
  {
    regex: /fatal[:\s]+(.{0,80})/i,
    template: (m) => `Fatal error: ${m[1]}`,
    keyword: 'fatal',
  },
  {
    regex: /SIGKILL|SIGTERM/i,
    template: () => 'Container killed by system (possible OOM or eviction)',
    keyword: 'SIGKILL',
  },
  {
    regex: /timeout|timed out/i,
    template: () => 'Operation timed out',
    keyword: 'timeout',
  },
  {
    regex: /permission denied|access denied|unauthorized|403/i,
    template: () => 'Permission or access denied',
    keyword: 'denied',
  },
  {
    regex: /no such file|not found|ENOENT/i,
    template: () => 'Required file or resource not found',
    keyword: 'not found',
  },
];

/**
 * Infer a likely root cause from log text.
 * Scans lines bottom-up (most recent first) for known error patterns.
 */
export function inferRootCause(logText: string): RootCauseResult {
  const lines = logText.split('\n').filter(Boolean).reverse();

  for (const line of lines) {
    for (const pattern of PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        return { cause: pattern.template(match), keyword: pattern.keyword };
      }
    }
  }

  return { cause: 'Investigate logs for root cause', keyword: null };
}

/**
 * Extract the most relevant error snippet from a log line.
 * Returns the trimmed line with a max length, or null if empty.
 */
export function extractErrorSnippet(logText: string, maxLength = 80): string | null {
  const lines = logText.split('\n').filter(Boolean).reverse();

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes('error') ||
      lower.includes('panic') ||
      lower.includes('fatal') ||
      lower.includes('failed') ||
      lower.includes('refused') ||
      lower.includes('timeout') ||
      lower.includes('oom') ||
      lower.includes('crash') ||
      lower.includes('exception')
    ) {
      const trimmed = line.trim();
      return trimmed.length > maxLength ? trimmed.slice(0, maxLength) + '...' : trimmed;
    }
  }

  // Fallback: last non-empty line
  const last = lines[0]?.trim();
  if (last) {
    return last.length > maxLength ? last.slice(0, maxLength) + '...' : last;
  }
  return null;
}

/** Known error keywords for highlighting in UI */
export const ERROR_KEYWORDS = [
  'error', 'panic', 'fatal', 'refused', 'timeout', 'oom',
  'crash', 'failed', 'exception', 'denied', 'killed',
];

export type { RootCauseResult };
