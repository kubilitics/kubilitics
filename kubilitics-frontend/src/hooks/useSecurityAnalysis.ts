// A-CORE-012: Security Analysis hooks — backed by real /api/v1/security/* endpoints.
// All security endpoints live on the AI backend (port 8081).
import { useState, useEffect, useCallback, useRef } from 'react';
import { AI_BASE_URL } from '@/services/aiService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' | 'UNKNOWN';
export type ComplianceStatus = 'pass' | 'fail' | 'warning' | 'not_applicable';

export interface IssueSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface SecurityIssue {
  type: string;
  severity: Severity;
  title: string;
  description: string;
  remediation: string;
  resource: string;
  namespace?: string;
  timestamp: string;
}

export interface SecurityPosture {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: IssueSummary;
  pod_scanned: number;
  roles_audited: number;
  namespaces: number;
  recommendations: string[];
  rbac_findings: number;
  network_gaps: number;
  secret_exposures: number;
  timestamp: string;
  note?: string;
}

export interface RBACFinding {
  resource_type: string;
  name: string;
  namespace?: string;
  issues: string[];
  severity: Severity;
  remediation: string;
}

export interface NetworkPolicyGap {
  namespace: string;
  pod_count: number;
  description: string;
  remediation: string;
}

export interface SecretExposure {
  name: string;
  namespace: string;
  secret_type: string;
  risk_level: string;
  description: string;
  remediation: string;
  mounted_by?: string[];
}

export interface ComplianceCheck {
  id: string;
  standard: string;
  section: string;
  title: string;
  description: string;
  status: ComplianceStatus;
  severity: Severity;
  details: string;
  remediation?: string;
  resource?: string;
  namespace?: string;
  timestamp: string;
}

export interface ComplianceReport {
  standard: string;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  warning_checks: number;
  compliance_score: number;
  checks: ComplianceCheck[];
  timestamp: string;
}

export interface Vulnerability {
  cve_id: string;
  severity: Severity;
  score: number;
  package: string;
  version: string;
  fixed_version?: string;
  description: string;
  published_date: string;
  references?: string[];
}

export interface VulnSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface ImageScanResult {
  image: string;
  tag: string;
  scan_time: string;
  vulnerabilities: Vulnerability[];
  summary: VulnSummary;
  vulnerability_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  risk_score: number;
  risk_level: string;
}

// Legacy compat export (previously used in other components)
export interface SecurityAnalysisResult {
  issues: SecurityIssue[];
  score: number;
  grade: string;
  summary: IssueSummary;
}

// ─── API base ─────────────────────────────────────────────────────────────────
// Security endpoints live on the AI backend. Use absolute URL to avoid Vite
// proxy routing them to the main backend (port 8080).
const API_BASE = `${AI_BASE_URL}/api/v1/security`;

// ─── useSecurityPosture — polls cluster-wide security posture ─────────────────

export function useSecurityPosture(opts: {
  pollIntervalMs?: number;
  enabled?: boolean;
} = {}) {
  const { pollIntervalMs = 60_000, enabled = true } = opts;

  const [data, setData] = useState<SecurityPosture | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/posture`, {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SecurityPosture = await res.json();
      setData(json);
      setError(null);
      setLastRefreshedAt(new Date());
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetch();
    if (!enabled) return;
    const id = setInterval(fetch, pollIntervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetch, enabled, pollIntervalMs]);

  return { data, loading, error, lastRefreshedAt, refresh: fetch };
}

// ─── useSecurityIssues — fetches filtered security issues ────────────────────

export function useSecurityIssues(opts: {
  severity?: Severity;
  issueType?: string;
  namespace?: string;
  enabled?: boolean;
} = {}) {
  const { severity, issueType, namespace, enabled = true } = opts;
  const [data, setData] = useState<{ issues: SecurityIssue[]; total: number; summary: IssueSummary } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (severity) params.set('severity', severity);
      if (issueType) params.set('type', issueType);
      if (namespace) params.set('namespace', namespace);
      const res = await window.fetch(`${API_BASE}/issues?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, severity, issueType, namespace]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, loading, error, refresh: fetchData };
}

// ─── useSecurityRBAC — RBAC audit findings ────────────────────────────────────

export function useSecurityRBAC(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [data, setData] = useState<{ findings: RBACFinding[]; total: number; by_severity: Record<string, number>; roles_audited: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/rbac`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, loading, error, refresh: fetchData };
}

// ─── useSecurityNetwork — network policy gaps ─────────────────────────────────

export function useSecurityNetwork(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [data, setData] = useState<{ gaps: NetworkPolicyGap[]; total_gaps: number; total_pods_exposed: number; namespaces_scanned: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/network`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, loading, error, refresh: fetchData };
}

// ─── useSecuritySecrets — secret exposure detection ──────────────────────────

export function useSecuritySecrets(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [data, setData] = useState<{ exposures: SecretExposure[]; total: number; by_risk: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/secrets`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, loading, error, refresh: fetchData };
}

// ─── useSecurityCompliance — CIS compliance report ───────────────────────────

export function useSecurityCompliance(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await window.fetch(`${API_BASE}/compliance`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { fetchData(); }, [fetchData]);
  return { data, loading, error, refresh: fetchData };
}

// ─── useImageScan — imperative: scan a container image ───────────────────────

export function useImageScan() {
  const [data, setData] = useState<ImageScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async (image: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await window.fetch(`${API_BASE}/scan/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  return { data, loading, error, scan };
}

// ─── useSecurityAnalysis — backward-compat shim for SecurityDashboard ─────────
//
// The legacy SecurityDashboard page calls:
//   const { analysisResult, isLoading, analyzePod } = useSecurityAnalysis();
// This shim maps to the /api/v1/security/analyze/pod endpoint.

export function useSecurityAnalysis() {
  const [analysisResult, setAnalysisResult] = useState<SecurityAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzePod = useCallback(async (podSpec: {
    name: string;
    namespace?: string;
    run_as_non_root?: boolean;
    privileged?: boolean;
    allow_privilege_escalation?: boolean;
  }) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await window.fetch(`${API_BASE}/analyze/pod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(podSpec),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json = await res.json();
      // Map backend response to SecurityAnalysisResult shape
      setAnalysisResult({
        score: json.score ?? 0,
        grade: json.grade ?? 'F',
        issues: json.issues ?? [],
        summary: json.summary ?? { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { analysisResult, isLoading, error, analyzePod };
}
