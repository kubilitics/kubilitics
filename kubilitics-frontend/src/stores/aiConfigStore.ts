/**
 * AI config store — tracks the user's AI provider/model preference in the UI.
 *
 * Source-of-truth policy:
 *   - The AI *backend* (SQLite via POST /api/v1/config/provider) owns the authoritative config
 *     including the API key. The UI reads it from GET /api/v1/config/provider on mount.
 *   - This store is a UI cache for the currently-edited form values only.
 *   - apiKey is intentionally NOT persisted to localStorage (it lives only in-memory while
 *     the Settings page is open and is sent directly to the backend on save).
 *   - provider / model / customEndpoint are persisted as lightweight UI preferences so the
 *     Settings form pre-fills sensibly on re-open (they are overwritten by the backend GET
 *     response when the page loads, so stale values are harmless).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Providers supported in the UI.
 * 'azure' is a UI alias — it is mapped to 'custom' before POSTing to the backend
 * (the backend only accepts: anthropic | openai | ollama | custom).
 */
export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'custom' | 'azure' | 'none';

/**
 * Map a UI provider to the provider string the AI backend accepts.
 * The backend doesn't know about 'azure' or 'none' — they are UI-only concepts.
 */
export function toBackendProvider(p: AIProvider): 'anthropic' | 'openai' | 'ollama' | 'custom' {
  if (p === 'azure') return 'custom';
  if (p === 'none') return 'custom'; // fallback; callers should guard for 'none'
  return p;
}

interface AIConfigState {
  provider: AIProvider;
  /** In-memory only — NOT persisted to localStorage. Cleared on page unload. */
  apiKey: string;
  model: string;
  customEndpoint: string;
  enabled: boolean;

  setProvider: (provider: AIProvider) => void;
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setCustomEndpoint: (endpoint: string) => void;
  setEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const initialState = {
  provider: 'openai' as AIProvider,
  /** Empty — populated from backend GET /api/v1/config/provider on Settings mount */
  apiKey: '',
  /** Empty — populated from backend on mount; auto-filled by model catalog on provider change */
  model: '',
  customEndpoint: '',
  enabled: false,
};

/** Fields that are safe to persist (no sensitive data) */
type PersistedFields = Pick<AIConfigState, 'provider' | 'model' | 'customEndpoint' | 'enabled'>;

export const useAIConfigStore = create<AIConfigState>()(
  persist(
    (set) => ({
      ...initialState,

      setProvider: (provider) => set({ provider }),
      setApiKey: (apiKey) => set({ apiKey }),
      setModel: (model) => set({ model }),
      setCustomEndpoint: (endpoint) => set({ customEndpoint: endpoint }),
      setEnabled: (enabled) => set({ enabled }),
      reset: () => set(initialState),
    }),
    {
      name: 'kubilitics-ai-config',
      storage: createJSONStorage(() => localStorage),
      // SECURITY: Never persist apiKey — it stays in-memory only and is sent
      // directly to the backend on save. The backend stores it in SQLite (app-local).
      partialize: (state): PersistedFields => ({
        provider: state.provider,
        model: state.model,
        customEndpoint: state.customEndpoint,
        enabled: state.enabled,
      }),
    }
  )
);
