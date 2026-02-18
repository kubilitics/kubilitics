import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'custom' | 'none';

interface AIConfigState {
    provider: AIProvider;
    // NOTE: apiKey is intentionally NOT persisted to localStorage.
    // The API key is sent to the kubilitics-ai backend (POST /api/v1/config/provider)
    // and stored only in memory on the server side. Use updateAIConfiguration() from
    // aiService.ts to apply key changes; use getAIConfiguration() to read back state.
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
    // apiKey is never persisted — intentionally kept empty in initial state
    apiKey: '',
    model: 'gpt-4',
    customEndpoint: '',
    enabled: false,
};

// Fields safe to persist to localStorage (never include apiKey)
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
            // Security: only persist non-sensitive fields. apiKey MUST NOT be stored locally.
            partialize: (state): PersistedFields => ({
                provider: state.provider,
                model: state.model,
                customEndpoint: state.customEndpoint,
                enabled: state.enabled,
            }),
        }
    )
);
