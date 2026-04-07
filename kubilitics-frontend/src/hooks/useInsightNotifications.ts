/**
 * useInsightNotifications — Enterprise-grade insight notification pipeline.
 *
 * Follows Datadog/PagerDuty patterns:
 * - Dedup: seen insight IDs persisted in localStorage (survives refresh)
 * - Rate limiting: max 5 notifications per 30s window (prevents toast flood)
 * - Grouping: multiple insights of the same rule batch into one notification
 *   (e.g., "3 image pull failures detected" instead of 3 separate toasts)
 * - Cooldown: same rule won't re-notify within 5 minutes
 * - Priority: critical/warning insights notify immediately; info batches
 *
 * Should be mounted once in a top-level component (e.g. AppLayout).
 */
import { useEffect, useRef } from 'react';
import { useActiveInsights } from '@/hooks/useEventsIntelligence';
import { useNotificationStore, type NotificationSeverity } from '@/stores/notificationStore';

// ─── Configuration ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'kubilitics:seen-insight-ids';
const COOLDOWN_KEY = 'kubilitics:insight-cooldowns';
const MAX_SEEN = 500;
/** Max notifications in a 30-second window */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 30_000;
/** Same rule won't re-notify within this window */
const RULE_COOLDOWN_MS = 5 * 60_000; // 5 minutes

// ─── Persistence helpers ────────────────────────────────────────────────────

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSet(key: string, ids: Set<string>, max: number) {
  try {
    const arr = [...ids];
    localStorage.setItem(key, JSON.stringify(arr.length > max ? arr.slice(arr.length - max) : arr));
  } catch { /* ignore */ }
}

function loadCooldowns(): Map<string, number> {
  try {
    const raw = localStorage.getItem(COOLDOWN_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persistCooldowns(cooldowns: Map<string, number>) {
  try {
    const now = Date.now();
    const obj: Record<string, number> = {};
    // Only persist non-expired cooldowns
    for (const [rule, ts] of cooldowns) {
      if (ts > now) obj[rule] = ts;
    }
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

// ─── Severity mapping ───────────────────────────────────────────────────────

function mapSeverity(severity: string): NotificationSeverity {
  switch (severity) {
    case 'critical': return 'error';
    case 'warning': return 'warning';
    default: return 'info';
  }
}

function severityPriority(severity: string): number {
  switch (severity) {
    case 'critical': return 3;
    case 'warning': return 2;
    default: return 1;
  }
}

// ─── Friendly rule descriptions ─────────────────────────────────────────────

const RULE_LABELS: Record<string, string> = {
  crashLoopDetected: 'CrashLoopBackOff detected',
  imagePullFailure: 'Image pull failure',
  oomKillDetected: 'OOMKill detected',
  schedulingFailures: 'Scheduling failure',
  restartStorm: 'High restart count',
  nodeCondition: 'Node condition alert',
};

function friendlyTitle(rule: string, count: number): string {
  const label = RULE_LABELS[rule] || rule;
  return count > 1 ? `${count}× ${label}` : label;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useInsightNotifications() {
  const { data: insights } = useActiveInsights();
  const addNotification = useNotificationStore((s) => s.addNotification);
  const seenIds = useRef(loadSet(STORAGE_KEY));
  const cooldowns = useRef(loadCooldowns());
  const recentNotifyTimestamps = useRef<number[]>([]);

  useEffect(() => {
    if (!insights || insights.length === 0) return;

    const now = Date.now();

    // Prune rate-limit window
    recentNotifyTimestamps.current = recentNotifyTimestamps.current.filter(
      (ts) => now - ts < RATE_WINDOW_MS
    );

    // Filter to unseen insights
    const unseen = insights.filter((i) => !seenIds.current.has(i.insight_id));
    if (unseen.length === 0) return;

    // Mark all as seen immediately (even if rate-limited, don't re-process)
    for (const i of unseen) {
      seenIds.current.add(i.insight_id);
    }
    persistSet(STORAGE_KEY, seenIds.current, MAX_SEEN);

    // Group by rule
    const groups = new Map<string, typeof unseen>();
    for (const insight of unseen) {
      const rule = insight.rule || 'unknown';
      const group = groups.get(rule) ?? [];
      group.push(insight);
      groups.set(rule, group);
    }

    // Emit grouped notifications with rate limiting and cooldowns
    let dirty = false;
    for (const [rule, group] of groups) {
      // Check cooldown — same rule won't re-notify within RULE_COOLDOWN_MS
      const cooldownUntil = cooldowns.current.get(rule) ?? 0;
      if (now < cooldownUntil) continue;

      // Check rate limit
      if (recentNotifyTimestamps.current.length >= RATE_LIMIT) continue;

      // Pick the highest severity from the group
      const highestSeverity = group.reduce(
        (max, i) => (severityPriority(i.severity) > severityPriority(max) ? i.severity : max),
        group[0].severity
      );

      // Build grouped notification
      const title = friendlyTitle(rule, group.length);
      const description = group.length === 1
        ? group[0].detail || group[0].message || group[0].title
        : group.slice(0, 3).map((i) => i.title || i.message || '').filter(Boolean).join(' · ')
          + (group.length > 3 ? ` (+${group.length - 3} more)` : '');

      addNotification({
        id: `insight-${rule}-${now}`,
        title,
        description,
        severity: mapSeverity(highestSeverity),
        category: 'cluster',
      });

      // Record rate limit + cooldown
      recentNotifyTimestamps.current.push(now);
      cooldowns.current.set(rule, now + RULE_COOLDOWN_MS);
      dirty = true;
    }

    if (dirty) {
      persistCooldowns(cooldowns.current);
    }
  }, [insights, addNotification]);
}
