import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Cluster {
  id: string;
  name: string;
  context: string;
  version: string;
  status: 'healthy' | 'warning' | 'error';
  region: string;
  provider: 'eks' | 'gke' | 'aks' | 'minikube' | 'kind' | 'on-prem' | 'openshift' | 'rancher' | 'k3s' | 'docker-desktop';
  nodes: number;
  namespaces: number;
  isCurrent?: boolean;
  pods: { running: number; pending: number; failed: number };
  cpu: { used: number; total: number };
  memory: { used: number; total: number };
}

export interface Namespace {
  name: string;
  status: 'Active' | 'Terminating';
  pods: number;
  services: number;
}

interface ClusterState {
  clusters: Cluster[];
  activeCluster: Cluster | null;
  activeNamespace: string;
  namespaces: Namespace[];
  isDemo: boolean;
  appMode: 'desktop' | 'in-cluster' | null;
  isOnboarded: boolean;
  setClusters: (clusters: Cluster[]) => void;
  setActiveCluster: (cluster: Cluster) => void;
  setActiveNamespace: (namespace: string) => void;
  setNamespaces: (namespaces: Namespace[]) => void;
  setDemo: (isDemo: boolean) => void;
  setAppMode: (mode: 'desktop' | 'in-cluster' | null) => void;
  setOnboarded: (onboarded: boolean) => void;
  signOut: () => void;
}

// Demo mock data
const demoClusters: Cluster[] = [
  {
    id: 'prod-us-east',
    name: 'production-us-east',
    context: 'prod-us-east-1',
    version: 'v1.28.4',
    status: 'healthy',
    region: 'us-east-1',
    provider: 'eks',
    nodes: 12,
    namespaces: 24,
    pods: { running: 156, pending: 3, failed: 1 },
    cpu: { used: 68, total: 100 },
    memory: { used: 72, total: 100 },
  },
  {
    id: 'staging-eu',
    name: 'staging-eu-west',
    context: 'staging-eu-west-1',
    version: 'v1.28.2',
    status: 'warning',
    region: 'eu-west-1',
    provider: 'eks',
    nodes: 6,
    namespaces: 12,
    pods: { running: 78, pending: 5, failed: 2 },
    cpu: { used: 45, total: 100 },
    memory: { used: 52, total: 100 },
  },
  {
    id: 'dev-local',
    name: 'development',
    context: 'minikube',
    version: 'v1.29.0',
    status: 'healthy',
    region: 'local',
    provider: 'minikube',
    nodes: 1,
    namespaces: 8,
    pods: { running: 24, pending: 0, failed: 0 },
    cpu: { used: 32, total: 100 },
    memory: { used: 41, total: 100 },
  },
];

const demoNamespaces: Namespace[] = [
  { name: 'default', status: 'Active', pods: 12, services: 4 },
  { name: 'kube-system', status: 'Active', pods: 28, services: 8 },
  { name: 'production', status: 'Active', pods: 45, services: 12 },
  { name: 'staging', status: 'Active', pods: 23, services: 6 },
  { name: 'monitoring', status: 'Active', pods: 15, services: 3 },
  { name: 'logging', status: 'Active', pods: 8, services: 2 },
  { name: 'ingress-nginx', status: 'Active', pods: 4, services: 1 },
  { name: 'cert-manager', status: 'Active', pods: 3, services: 1 },
];

export const useClusterStore = create<ClusterState>()(
  persist(
    (set) => ({
      clusters: [],
      activeCluster: null,
      activeNamespace: 'all',
      namespaces: [],
      isDemo: false,
      appMode: null,
      isOnboarded: false,
      setClusters: (clusters) => set({ clusters }),
      setActiveCluster: (cluster) => set({ activeCluster: cluster }),
      setActiveNamespace: (namespace) => set({ activeNamespace: namespace }),
      setNamespaces: (namespaces) => set({ namespaces }),
      setAppMode: (appMode) => set({ appMode }),
      setOnboarded: (isOnboarded) => set({ isOnboarded }),
      setDemo: (isDemo) => {
        if (isDemo) {
          set({
            isDemo,
            clusters: demoClusters,
            activeCluster: demoClusters[0],
            namespaces: demoNamespaces,
          });
        } else {
          set({ isDemo: false });
        }
      },
      signOut: () =>
        set({
          clusters: [],
          activeCluster: null,
          activeNamespace: 'all',
          namespaces: [],
          isDemo: false,
          appMode: null,
          isOnboarded: false,
        }),
    }),
    {
      name: 'kubilitics-cluster',
    }
  )
);
