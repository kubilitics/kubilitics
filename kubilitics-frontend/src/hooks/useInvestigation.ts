/**
 * useInvestigation - hook for managing AI investigation sessions.
 *
 * Covers:
 *   POST /api/v1/investigations       - start investigation
 *   GET  /api/v1/investigations       - list all
 *   GET  /api/v1/investigations/{id}  - get one
 *   DELETE /api/v1/investigations/{id} - cancel
 *   WS   /ws/investigations/{id}      - real-time event stream
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { AI_BASE_URL, AI_WS_URL } from '../services/aiService';

// ─── Types matching engine_impl.go ───────────────────────────────────────────

export type InvestigationState =
  | 'CREATED'
  | 'INVESTIGATING'
  | 'ANALYZING'
  | 'CONCLUDED'
  | 'FAILED'
  | 'CANCELLED';

export interface Finding {
  statement: string;
  evidence: string;
  confidence: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  timestamp: string;
}

export interface ToolCallRecord {
  tool_name: string;
  args: Record<string, unknown>;
  result: string;
  turn_index: number;
  timestamp: string;
}

export interface InvestigationStep {
  number: number;
  description: string;
  result: string;
  timestamp: string;
}

export interface Investigation {
  id: string;
  type: string;
  state: InvestigationState;
  description: string;
  context: string;
  findings: Finding[];
  tool_calls: ToolCallRecord[];
  conclusion: string;
  confidence: number;
  steps: InvestigationStep[];
  tokens_used: number;
  created_at: string;
  updated_at: string;
  concluded_at?: string;
  metadata: Record<string, unknown>;
}

// Server-side ToolEvent shape (mirroring llm/types)
export interface LLMToolEvent {
  phase: 'calling' | 'result' | 'error';
  call_id: string;
  tool_name: string;
  turn_index: number;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

export type InvestigationEventType =
  | 'step'
  | 'tool'
  | 'text'
  | 'finding'
  | 'conclusion'
  | 'done'
  | 'error';

export interface InvestigationEvent {
  investigation_id: string;
  type: InvestigationEventType;
  step?: InvestigationStep;
  tool_event?: LLMToolEvent;
  text_token?: string;
  finding?: Finding;
  conclusion?: string;
  error?: string;
  state: InvestigationState;
  timestamp: string;
}

// ─── Hook state ───────────────────────────────────────────────────────────────

export interface InvestigationStreamState {
  investigation: Investigation | null;
  events: InvestigationEvent[];
  streamText: string;     // accumulated text tokens from LLM
  isStreaming: boolean;
  error: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AI_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json();
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${AI_BASE_URL}${path}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${msg}`);
  }
  return res.json();
}

async function apiDelete(path: string): Promise<void> {
  await fetch(`${AI_BASE_URL}${path}`, { method: 'DELETE' });
}

// ─── useStartInvestigation ────────────────────────────────────────────────────

/**
 * Starts a new investigation and opens a WebSocket stream for real-time events.
 */
export function useInvestigation() {
  const [state, setState] = useState<InvestigationStreamState>({
    investigation: null,
    events: [],
    streamText: '',
    isStreaming: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    clearPolling();
  }, [clearPolling]);

  // Cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect]);

  /** Poll the REST endpoint to pick up state if WS fails. */
  const startPolling = useCallback((id: string) => {
    clearPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const inv = await apiGet<Investigation>(`/api/v1/investigations/${id}`);
        setState(prev => ({ ...prev, investigation: inv }));
        if (
          inv.state === 'CONCLUDED' ||
          inv.state === 'FAILED' ||
          inv.state === 'CANCELLED'
        ) {
          clearPolling();
          setState(prev => ({ ...prev, isStreaming: false }));
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
  }, [clearPolling]);

  /** Open WebSocket stream for an existing investigation ID. */
  const connectStream = useCallback(
    (id: string) => {
      disconnect();

      const wsUrl = `${AI_WS_URL}/ws/investigations/${id}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({ ...prev, isStreaming: true, error: null }));
      };

      ws.onmessage = (msg) => {
        try {
          const ev: InvestigationEvent = JSON.parse(msg.data);

          setState(prev => {
            const events = [...prev.events, ev];
            let streamText = prev.streamText;
            let investigation = prev.investigation;

            if (ev.type === 'text' && ev.text_token) {
              streamText += ev.text_token;
            }

            // Merge findings and steps into local investigation snapshot
            if (investigation) {
              if (ev.type === 'finding' && ev.finding) {
                investigation = {
                  ...investigation,
                  state: ev.state,
                  findings: [...investigation.findings, ev.finding],
                };
              } else if (ev.type === 'step' && ev.step) {
                const existingIdx = investigation.steps.findIndex(
                  s => s.description === ev.step!.description
                );
                const steps = [...investigation.steps];
                if (existingIdx >= 0) {
                  steps[existingIdx] = ev.step;
                } else {
                  steps.push(ev.step);
                }
                investigation = { ...investigation, state: ev.state, steps };
              } else if (ev.type === 'conclusion' && ev.conclusion) {
                investigation = {
                  ...investigation,
                  state: ev.state,
                  conclusion: ev.conclusion,
                };
              } else if (ev.type === 'tool' && ev.tool_event?.phase === 'result') {
                const te = ev.tool_event;
                const rec: ToolCallRecord = {
                  tool_name: te.tool_name,
                  args: te.args ?? {},
                  result: te.result ?? '',
                  turn_index: te.turn_index,
                  timestamp: ev.timestamp,
                };
                investigation = {
                  ...investigation,
                  state: ev.state,
                  tool_calls: [...investigation.tool_calls, rec],
                };
              } else {
                investigation = { ...investigation, state: ev.state };
              }
            }

            return { ...prev, events, streamText, investigation };
          });

          if (ev.type === 'done') {
            // Fetch final state from REST to get full investigation
            apiGet<Investigation>(`/api/v1/investigations/${id}`)
              .then(inv =>
                setState(prev => ({ ...prev, investigation: inv, isStreaming: false }))
              )
              .catch(() => setState(prev => ({ ...prev, isStreaming: false })));
            ws.close();
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        setState(prev => ({
          ...prev,
          error: 'WebSocket error — falling back to polling',
          isStreaming: false,
        }));
        startPolling(id);
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };
    },
    [disconnect, startPolling]
  );

  /** Start a new investigation. Returns the investigation ID. */
  const startInvestigation = useCallback(
    async (description: string, type = 'general'): Promise<string> => {
      setState({
        investigation: null,
        events: [],
        streamText: '',
        isStreaming: false,
        error: null,
      });

      let resp: { id: string; type: string; description: string; state: string };
      try {
        resp = await apiPost('/api/v1/investigations', { description, type });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState(prev => ({ ...prev, error: `Failed to start: ${msg}` }));
        throw err;
      }

      const inv: Investigation = {
        id: resp.id,
        type: resp.type,
        state: (resp.state as InvestigationState) || 'CREATED',
        description: resp.description,
        context: '',
        findings: [],
        tool_calls: [],
        conclusion: '',
        confidence: 0,
        steps: [],
        tokens_used: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      };

      setState(prev => ({ ...prev, investigation: inv }));
      connectStream(resp.id);
      return resp.id;
    },
    [connectStream]
  );

  /** Cancel an in-progress investigation. */
  const cancelInvestigation = useCallback(
    async (id: string) => {
      await apiDelete(`/api/v1/investigations/${id}`);
      disconnect();
      setState(prev => ({
        ...prev,
        isStreaming: false,
        investigation: prev.investigation
          ? { ...prev.investigation, state: 'CANCELLED' }
          : null,
      }));
    },
    [disconnect]
  );

  return {
    ...state,
    startInvestigation,
    cancelInvestigation,
    disconnect,
  };
}

// ─── useInvestigationList ─────────────────────────────────────────────────────

export function useInvestigationList() {
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiGet<{ investigations: Investigation[]; count: number }>(
        '/api/v1/investigations'
      );
      setInvestigations(resp.investigations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { investigations, loading, error, reload: load };
}
