/**
 * Kubilitics AI service layer.
 * HTTP client for the kubilitics-ai backend (default port 8081).
 *
 * Endpoints covered:
 *   GET  /health                              - health check
 *   GET  /ready                               - readiness check
 *   GET  /info                                - server info
 *   POST /api/v1/llm/complete                 - non-streaming LLM completion
 *   POST /api/v1/llm/stream                   - streaming via SSE
 *   POST /api/v1/safety/evaluate              - safety evaluation
 *   GET  /api/v1/safety/rules                 - list safety rules
 *   GET  /api/v1/safety/policies              - list safety policies
 *   GET  /api/v1/analytics/anomalies          - anomaly detection results
 *   GET  /api/v1/analytics/trends             - trend analysis
 *   GET  /api/v1/analytics/recommendations    - AI-driven recommendations
 *   GET  /api/v1/conversations                - list conversations
 *   GET  /api/v1/conversations/{id}           - get conversation by ID
 *   GET  /api/v1/config/models                - curated model catalog per provider
 *   POST /api/v1/config/validate              - validate API key without saving
 *   WS   /ws/chat                             - AI chat WebSocket (see useWebSocket hook)
 *
 * Configuration:
 *   VITE_AI_BACKEND_URL  - HTTP base URL  (default http://localhost:8081)
 *   VITE_AI_WS_URL       - WebSocket URL  (default ws://localhost:8081)
 */

// ─── Base URL ────────────────────────────────────────────────────────────────

import { getCurrentAiBackendUrl, getCurrentAiWsUrl } from '@/stores/backendConfigStore';
import { getAIAvailableForRequest } from '@/stores/aiAvailableStore';
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_WS_URL } from '@/lib/backendConstants';

export const AI_BASE_URL = DEFAULT_AI_BASE_URL;
export const AI_WS_URL = DEFAULT_AI_WS_URL;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AITool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface AICompleteRequest {
  messages: AIMessage[];
  tools?: AITool[];
  stream?: boolean;
}

export interface AICompleteResponse {
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
}

export interface AIServerInfo {
  name: string;
  version: string;
  llm_provider: string;
  safety_engine_enabled: boolean;
  analytics_enabled: boolean;
  autonomy_level: number;
  timestamp: string;
}

export interface AIHealthResponse {
  status: 'healthy' | 'not_ready';
  timestamp?: string;
}

export interface SafetyEvaluateRequest {
  action: string;
  context?: Record<string, unknown>;
}

export interface SafetyEvaluateResponse {
  allowed: boolean;
  risk_level: string;
  reason: string;
  autonomy_required: number;
}

export interface AnalyticsAnomaly {
  resource: string;
  namespace: string;
  metric: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detected_at: string;
  value: number;
  threshold: number;
}

export interface AnalyticsTrend {
  resource: string;
  metric: string;
  direction: 'increasing' | 'decreasing' | 'stable';
  change_percent: number;
  period: string;
}

export interface AnalyticsRecommendation {
  id: string;
  type: string;
  resource: string;
  namespace: string;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  potential_savings?: number;
}

export interface ConversationMessage {
  role: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  messages: ConversationMessage[];
  context?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Backend-accepted provider values.
 * The AI backend only supports these four — 'azure' and 'none' are UI-only concepts
 * and must be mapped before any POST to the backend (use toBackendProvider() from aiConfigStore).
 */
export type BackendProvider = 'openai' | 'anthropic' | 'ollama' | 'custom';

/**
 * Shape of requests sent TO the backend (POST /api/v1/config/provider and validate).
 * Provider must be a BackendProvider — never 'azure' or 'none'.
 */
export interface LLMProviderConfig {
  provider: BackendProvider;
  api_key?: string;
  base_url?: string;
  model?: string;
}

/**
 * Shape of responses received FROM the backend (GET /api/v1/config/provider).
 * The backend may return provider='none' if nothing is configured yet.
 * The api_key is intentionally absent (security — backend never echoes it).
 */
export interface LLMProviderConfigResponse {
  provider: BackendProvider | 'none';
  model?: string;
  base_url?: string;
  configured?: boolean;
}

/** A single model option returned by GET /api/v1/config/models */
export interface ModelOption {
  id: string;
  name: string;
  recommended?: boolean;
}

/** Response shape for GET /api/v1/config/models */
export interface ProviderModelsResponse {
  models: Record<string, ModelOption[]>;
}

/** Response shape for POST /api/v1/config/validate */
export interface ValidateKeyResponse {
  valid: boolean;
  message?: string;
  error?: string;
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

// ─── Core request helper ─────────────────────────────────────────────────────

// Check if error is CORS-related
function isCORSError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const msg = err.message.toLowerCase();
    return msg.includes('cors') || msg.includes('access control') || msg.includes('cross-origin') || msg.includes('failed to fetch');
  }
  return false;
}

async function aiRequest<T>(
  path: string,
  init?: RequestInit,
  retries: number = 3,
  // TASK-AI-003: Bypass the sidecar-available guard for config/setup endpoints.
  // The AI Setup modal must POST config BEFORE the sidecar is running, so we
  // cannot gate those calls on aiAvailable === true (chicken-and-egg deadlock).
  skipAvailabilityGuard: boolean = false
): Promise<T> {
  // P2-8: In Tauri, do not hit AI backend when sidecar is not available.
  // Config/provider endpoints bypass this so setup can complete first.
  if (!skipAvailabilityGuard && !getAIAvailableForRequest()) {
    throw new AIServiceError('AI backend is not available.');
  }

  const url = `${getCurrentAiBackendUrl()}${path}`;
  let lastError: Error | null = null;

  // Retry logic with exponential backoff
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        ...init,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        let errorMessage = `AI service error ${response.status} on ${path}`;
        
        // Improve error messages based on status code
        if (response.status === 401 || response.status === 403) {
          errorMessage = 'API key is invalid or expired. Please check your API key in Settings → AI Configuration.';
        } else if (response.status === 404) {
          errorMessage = `AI backend endpoint not found: ${path}. Ensure the AI service is running and up to date.`;
        } else if (response.status === 503 || response.status === 502) {
          errorMessage = 'AI backend is temporarily unavailable. Please try again in a moment.';
        } else if (body) {
          try {
            const errorBody = JSON.parse(body);
            if (errorBody.error) {
              errorMessage = errorBody.error;
            }
          } catch {
            // Use body as-is if not JSON
            if (body.length < 200) {
              errorMessage = body;
            }
          }
        }
        
        throw new AIServiceError(errorMessage, response.status, body);
      }

      return await response.json() as Promise<T>;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Don't retry on CORS errors or client errors (4xx)
      if (isCORSError(err)) {
        throw new AIServiceError(
          'CORS error: AI backend may not be running or CORS is not configured. Ensure the AI service is running on localhost:8081 and CORS is enabled.',
          0,
          undefined
        );
      }
      
      if (err instanceof AIServiceError && err.status >= 400 && err.status < 500) {
        // Don't retry client errors (4xx)
        throw err;
      }

      // Retry on network errors or server errors (5xx) with exponential backoff
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Last attempt failed
      if (err instanceof AIServiceError) {
        throw err;
      }
      
      throw new AIServiceError(
        `AI service unreachable at ${url}: ${lastError.message}`,
        0,
        undefined
      );
    }
  }

  throw lastError || new Error('Unknown error');
}

// ─── Health & Info ────────────────────────────────────────────────────────────

export async function getAIHealth(): Promise<AIHealthResponse> {
  // skipAvailabilityGuard=true: health-check must work even before aiAvailable is confirmed
  // (used by Settings → Test Connection and by useAIStatus polling during setup).
  return aiRequest<AIHealthResponse>('/health', undefined, 3, true);
}

export async function getAIReadiness(): Promise<AIHealthResponse> {
  return aiRequest<AIHealthResponse>('/ready', undefined, 3, true);
}

export async function getAIInfo(): Promise<AIServerInfo> {
  // skipAvailabilityGuard=true: called right after updateAIConfiguration during setup flow.
  return aiRequest<AIServerInfo>('/info', undefined, 3, true);
}

// ─── LLM Completion ──────────────────────────────────────────────────────────

export async function llmComplete(
  req: AICompleteRequest
): Promise<AICompleteResponse> {
  return aiRequest<AICompleteResponse>('/api/v1/llm/complete', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ─── Safety ──────────────────────────────────────────────────────────────────

export async function safetyEvaluate(
  req: SafetyEvaluateRequest
): Promise<SafetyEvaluateResponse> {
  return aiRequest<SafetyEvaluateResponse>('/api/v1/safety/evaluate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function getSafetyRules(): Promise<unknown[]> {
  return aiRequest<unknown[]>('/api/v1/safety/rules');
}

export async function getSafetyPolicies(): Promise<unknown[]> {
  return aiRequest<unknown[]>('/api/v1/safety/policies');
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export async function getAnomalies(
  namespace?: string
): Promise<AnalyticsAnomaly[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return aiRequest<AnalyticsAnomaly[]>(`/api/v1/analytics/anomalies${qs}`);
}

export async function getTrends(
  namespace?: string
): Promise<AnalyticsTrend[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return aiRequest<AnalyticsTrend[]>(`/api/v1/analytics/trends${qs}`);
}

export async function getRecommendations(
  namespace?: string
): Promise<AnalyticsRecommendation[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return aiRequest<AnalyticsRecommendation[]>(
    `/api/v1/analytics/recommendations${qs}`
  );
}

// ─── ML Analytics (A-CORE-ML) ─────────────────────────────────────────────────
// These endpoints are handled by ml_handlers.go in the AI backend.

export interface MLAnomalyPoint {
  timestamp: string;
  value: number;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
  path_length?: number;
}

export interface MLModelInfo {
  algorithm: string;
  num_trees: number;
  sample_size: number;
  threshold: number;
  total_points: number;
}

export interface MLAnomalyRequest {
  time_series: {
    metric_name: string;
    metric_type: string;
    data: Array<{ timestamp: string; value: number }>;
  };
  algorithm?: 'isolation_forest' | 'ensemble';
  sensitivity?: number;
  num_trees?: number;
  sample_size?: number;
}

export interface MLAnomalyResponse {
  anomalies: MLAnomalyPoint[];
  model_info: MLModelInfo;
  total_points: number;
  anomaly_rate: number;
}

export async function detectMLAnomalies(
  req: MLAnomalyRequest
): Promise<MLAnomalyResponse> {
  return aiRequest<MLAnomalyResponse>('/api/v1/analytics/ml/anomalies', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export interface ForecastPoint {
  timestamp: string;
  value: number;
  lower_95: number;
  upper_95: number;
}

export interface ForecastModelInfo {
  order: number[];
  fitted: boolean;
  ar_coeffs: number[];
  ma_coeffs: number[];
  constant: number;
  std_error: number;
  n_residuals: number;
}

export interface ForecastRequest {
  time_series: {
    metric_name: string;
    metric_type: string;
    data: Array<{ timestamp: string; value: number }>;
  };
  forecast_steps?: number;
  model?: 'arima' | 'auto';
  arima_order?: [number, number, number];
}

export interface ForecastResponse {
  forecasts: ForecastPoint[];
  model_info: ForecastModelInfo;
  std_error: number;
  metric_name: string;
  forecast_horizon: number;
}

export async function forecastTimeSeries(
  req: ForecastRequest
): Promise<ForecastResponse> {
  return aiRequest<ForecastResponse>('/api/v1/analytics/forecast', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export interface MLModelDescription {
  name: string;
  algorithm: string;
  parameters: Record<string, unknown>;
  use_cases: string[];
  output_fields: string[];
}

export async function getMLModels(): Promise<{ models: MLModelDescription[] }> {
  return aiRequest<{ models: MLModelDescription[] }>('/api/v1/analytics/ml/models');
}

// ─── Conversations ────────────────────────────────────────────────────────────

export async function listConversations(): Promise<{
  conversations: Conversation[];
  count: number;
}> {
  return aiRequest<{ conversations: Conversation[]; count: number }>(
    '/api/v1/conversations'
  );
}

export async function getConversation(id: string): Promise<Conversation> {
  return aiRequest<Conversation>(`/api/v1/conversations/${id}`);
}

// ─── LLM Provider Configuration (stored in local storage for now) ─────────────

const LLM_CONFIG_KEY = 'kubilitics_ai_provider_config';

export async function updateAIConfiguration(config: LLMProviderConfig): Promise<void> {
  // Security fix: Send config to backend, never store API keys in localStorage.
  // TASK-AI-003: skipAvailabilityGuard=true — this IS the setup call; must work
  // even when the AI sidecar is not yet marked available (bootstrap flow).
  await aiRequest('/api/v1/config/provider', {
    method: 'POST',
    body: JSON.stringify(config),
  }, 3, true);
}

export async function getAIConfiguration(): Promise<LLMProviderConfigResponse> {
  // TASK-AI-003: skipAvailabilityGuard=true — reading config must work during setup.
  return aiRequest<LLMProviderConfigResponse>('/api/v1/config/provider', undefined, 3, true);
}

/**
 * Fetch the curated model catalog from the backend.
 * Returns a map of provider → list of { id, name, recommended? }.
 * Used by the Settings and AISetupModal to render the model dropdown.
 * skipAvailabilityGuard=true so it works during first-time setup.
 */
export async function getProviderModels(): Promise<ProviderModelsResponse> {
  return aiRequest<ProviderModelsResponse>('/api/v1/config/models', undefined, 1, true);
}

/**
 * Validate an API key + model combination against the provider without saving.
 * Call this before updateAIConfiguration() to give the user immediate feedback.
 * Returns { valid: true } on success or { valid: false, error: "..." } on failure.
 */
export async function validateAIKey(config: LLMProviderConfig): Promise<ValidateKeyResponse> {
  return aiRequest<ValidateKeyResponse>('/api/v1/config/validate', {
    method: 'POST',
    body: JSON.stringify(config),
  }, 1, true);
}

/**
 * @deprecated Use updateAIConfiguration (server-side persistence) instead.
 * This remains only for non-sensitive preferences if needed.
 */
export function saveLLMProviderConfig(config: LLMProviderConfig): void {
  // Legacy cleanup: ensure no sensitive data lingers
  localStorage.removeItem(LLM_CONFIG_KEY);
}

/**
 * @deprecated Use getAIConfiguration (server-side persistence) instead.
 */
export function loadLLMProviderConfig(): LLMProviderConfig | null {
  return null;
}

export function clearLLMProviderConfig(): void {
  localStorage.removeItem(LLM_CONFIG_KEY);
}

// ─── Investigations ───────────────────────────────────────────────────────────

export interface InvestigationCreateRequest {
  description: string;
  type?: string;
}

export interface InvestigationCreateResponse {
  id: string;
  type: string;
  description: string;
  state: string;
  stream_url: string;
}

export interface InvestigationSummary {
  id: string;
  type: string;
  state: string;
  description: string;
  conclusion: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  concluded_at?: string;
}

export async function createInvestigation(
  req: InvestigationCreateRequest
): Promise<InvestigationCreateResponse> {
  return aiRequest<InvestigationCreateResponse>('/api/v1/investigations', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function listInvestigations(): Promise<{
  investigations: InvestigationSummary[];
  count: number;
}> {
  return aiRequest<{ investigations: InvestigationSummary[]; count: number }>(
    '/api/v1/investigations'
  );
}

export async function getInvestigation(id: string): Promise<InvestigationSummary> {
  return aiRequest<InvestigationSummary>(`/api/v1/investigations/${id}`);
}

export async function cancelInvestigation(id: string): Promise<{ id: string; state: string }> {
  return aiRequest<{ id: string; state: string }>(`/api/v1/investigations/${id}`, {
    method: 'DELETE',
  });
}

/** Build a WebSocket URL for streaming investigation events */
export function buildInvestigationStreamUrl(id: string): string {
  return `${getCurrentAiWsUrl()}/ws/investigations/${id}`;
}

// ─── WebSocket chat URL builder ───────────────────────────────────────────────

export interface WSChatContext {
  namespace?: string;
  resource?: string;
  screen?: string;
}

export function buildChatWSUrl(context?: WSChatContext): string {
  const params = new URLSearchParams();
  if (context?.namespace) params.set('namespace', context.namespace);
  if (context?.resource) params.set('resource', context.resource);
  if (context?.screen) params.set('screen', context.screen);
  const qs = params.toString();
  return `${getCurrentAiWsUrl()}/ws/chat${qs ? `?${qs}` : ''}`;
}
