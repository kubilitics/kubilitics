import { create } from 'zustand';
import { stopPortForward } from '@/services/backendApiClient';

export interface ActivePortForward {
  sessionId: string;
  clusterId: string;
  clusterName: string;
  resourceType: 'pod' | 'service';
  resourceName: string;
  namespace: string;
  localPort: number;
  remotePort: number;
  baseUrl: string;
  startedAt: number; // Date.now()
}

interface PortForwardStore {
  forwards: ActivePortForward[];
  add: (fwd: ActivePortForward) => void;
  remove: (sessionId: string) => void;
  stopAndRemove: (sessionId: string) => Promise<void>;
  stopAll: () => Promise<void>;
  getByCluster: (clusterId: string) => ActivePortForward[];
}

export const usePortForwardStore = create<PortForwardStore>((set, get) => ({
  forwards: [],

  add: (fwd) => {
    set((state) => ({
      forwards: [...state.forwards.filter((f) => f.sessionId !== fwd.sessionId), fwd],
    }));
  },

  remove: (sessionId) => {
    set((state) => ({
      forwards: state.forwards.filter((f) => f.sessionId !== sessionId),
    }));
  },

  stopAndRemove: async (sessionId) => {
    const fwd = get().forwards.find((f) => f.sessionId === sessionId);
    if (fwd) {
      try {
        await stopPortForward(fwd.baseUrl, fwd.clusterId, sessionId);
      } catch {
        // Best effort — session may have already ended
      }
    }
    get().remove(sessionId);
  },

  stopAll: async () => {
    const all = get().forwards;
    await Promise.allSettled(
      all.map((f) =>
        stopPortForward(f.baseUrl, f.clusterId, f.sessionId).catch(() => {})
      )
    );
    set({ forwards: [] });
  },

  getByCluster: (clusterId) => {
    return get().forwards.filter((f) => f.clusterId === clusterId);
  },
}));
