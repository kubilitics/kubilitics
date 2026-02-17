/**
 * useAIStatus — E-PLAT-004
 * Polls /api/v1/health on the kubilitics-ai backend (port 8081) every 30 s.
 * Returns { status: 'active' | 'unavailable' | 'unconfigured', provider, model, error }
 *
 * 'active'       — backend responded, LLM provider configured and healthy
 * 'unconfigured' — backend responded but no LLM provider set (KUBILITICS_LLM_PROVIDER empty)
 * 'unavailable'  — backend unreachable or returned error (net error / 5xx)
 */
import { useEffect, useRef, useState } from 'react';
import { AI_BASE_URL as AI_BACKEND_URL } from '@/services/aiService';

export type AIStatusKind = 'active' | 'unconfigured' | 'unavailable';

export interface AIStatus {
  status: AIStatusKind;
  provider?: string;
  model?: string;
  version?: string;
  errorMessage?: string;
  /** True when the status check is in-flight */
  checking: boolean;
}

const POLL_INTERVAL_MS = 30_000;

interface HealthResponse {
  status?: string;
  version?: string;
  llm_provider?: string;
  llm_model?: string;
  llm_configured?: boolean;
}

async function fetchAIHealth(signal: AbortSignal): Promise<AIStatus> {
  try {
    const res = await fetch(`${AI_BACKEND_URL}/api/v1/health`, { signal });
    if (!res.ok) {
      return { status: 'unavailable', errorMessage: `HTTP ${res.status}`, checking: false };
    }
    const data: HealthResponse = await res.json();
    const llmConfigured = data.llm_configured ?? !!(data.llm_provider && data.llm_provider !== 'none');
    if (!llmConfigured) {
      return {
        status: 'unconfigured',
        version: data.version,
        checking: false,
      };
    }
    return {
      status: 'active',
      provider: data.llm_provider,
      model: data.llm_model,
      version: data.version,
      checking: false,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // component unmounted, return current state silently
      return { status: 'unavailable', checking: false };
    }
    return { status: 'unavailable', errorMessage: 'AI service unreachable', checking: false };
  }
}

export function useAIStatus(): AIStatus {
  const [status, setStatus] = useState<AIStatus>({ status: 'unavailable', checking: true });
  const abortRef = useRef<AbortController | null>(null);

  const check = () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus((prev) => ({ ...prev, checking: true }));
    fetchAIHealth(ctrl.signal).then((s) => setStatus(s));
  };

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return status;
}
