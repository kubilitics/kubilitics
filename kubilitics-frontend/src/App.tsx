import { Suspense, lazy, useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useClusterStore } from "@/stores/clusterStore";
import { AIAssistant } from "@/components/AIAssistant";
import { Loader2 } from "lucide-react";

// Loading Fallback Component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh] w-full">
    <Loader2 className="h-8 w-8 animate-spin text-blue-500 opacity-50" />
  </div>
);

// Pages - Entry & Setup
const ModeSelection = lazy(() => import("./pages/ModeSelection"));
const ClusterConnect = lazy(() => import("./pages/ClusterConnect"));
const ConnectedRedirect = lazy(() => import("./pages/ConnectedRedirect"));
const KubeConfigSetup = lazy(() => import("./pages/KubeConfigSetup"));
const ClusterSelection = lazy(() => import("./pages/ClusterSelection"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));

// Workloads
const Pods = lazy(() => import("./pages/Pods"));
const PodDetail = lazy(() => import("./pages/PodDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Deployments = lazy(() => import("./pages/Deployments"));
const DeploymentDetail = lazy(() => import("./pages/DeploymentDetail"));
const ReplicaSets = lazy(() => import("./pages/ReplicaSets"));
const ReplicaSetDetail = lazy(() => import("./pages/ReplicaSetDetail"));
const StatefulSets = lazy(() => import("./pages/StatefulSets"));
const StatefulSetDetail = lazy(() => import("./pages/StatefulSetDetail"));
const DaemonSets = lazy(() => import("./pages/DaemonSets"));
const DaemonSetDetail = lazy(() => import("./pages/DaemonSetDetail"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetail = lazy(() => import("./pages/JobDetail"));
const CronJobs = lazy(() => import("./pages/CronJobs"));
const CronJobDetail = lazy(() => import("./pages/CronJobDetail"));
const ReplicationControllers = lazy(() => import("./pages/ReplicationControllers"));
const ReplicationControllerDetail = lazy(() => import("./pages/ReplicationControllerDetail"));
const PodTemplates = lazy(() => import("./pages/PodTemplates"));
const PodTemplateDetail = lazy(() => import("./pages/PodTemplateDetail"));
const ControllerRevisions = lazy(() => import("./pages/ControllerRevisions"));
const ControllerRevisionDetail = lazy(() => import("./pages/ControllerRevisionDetail"));
const ResourceSlices = lazy(() => import("./pages/ResourceSlices"));
const ResourceSliceDetail = lazy(() => import("./pages/ResourceSliceDetail"));
const DeviceClasses = lazy(() => import("./pages/DeviceClasses"));
const DeviceClassDetail = lazy(() => import("./pages/DeviceClassDetail"));
const IPAddressPools = lazy(() => import("./pages/IPAddressPools"));
const IPAddressPoolDetail = lazy(() => import("./pages/IPAddressPoolDetail"));
const BGPPeers = lazy(() => import("./pages/BGPPeers"));
const BGPPeerDetail = lazy(() => import("./pages/BGPPeerDetail"));
const WorkloadsOverview = lazy(() => import("./pages/WorkloadsOverview"));

// Networking
const Services = lazy(() => import("./pages/Services"));
const ServiceDetail = lazy(() => import("./pages/ServiceDetail"));
const Endpoints = lazy(() => import("./pages/Endpoints"));
const EndpointDetail = lazy(() => import("./pages/EndpointDetail"));
const EndpointSlices = lazy(() => import("./pages/EndpointSlices"));
const EndpointSliceDetail = lazy(() => import("./pages/EndpointSliceDetail"));
const Ingresses = lazy(() => import("./pages/Ingresses"));
const IngressDetail = lazy(() => import("./pages/IngressDetail"));
const IngressClasses = lazy(() => import("./pages/IngressClasses"));
const IngressClassDetail = lazy(() => import("./pages/IngressClassDetail"));
const NetworkPolicies = lazy(() => import("./pages/NetworkPolicies"));
const NetworkPolicyDetail = lazy(() => import("./pages/NetworkPolicyDetail"));

// Storage & Config
const ConfigMaps = lazy(() => import("./pages/ConfigMaps"));
const ConfigMapDetail = lazy(() => import("./pages/ConfigMapDetail"));
const Secrets = lazy(() => import("./pages/Secrets"));
const SecretDetail = lazy(() => import("./pages/SecretDetail"));
const PersistentVolumes = lazy(() => import("./pages/PersistentVolumes"));
const PersistentVolumeDetail = lazy(() => import("./pages/PersistentVolumeDetail"));
const PersistentVolumeClaims = lazy(() => import("./pages/PersistentVolumeClaims"));
const PersistentVolumeClaimDetail = lazy(() => import("./pages/PersistentVolumeClaimDetail"));
const StorageClasses = lazy(() => import("./pages/StorageClasses"));
const StorageClassDetail = lazy(() => import("./pages/StorageClassDetail"));
const VolumeAttachments = lazy(() => import("./pages/VolumeAttachments"));
const VolumeAttachmentDetail = lazy(() => import("./pages/VolumeAttachmentDetail"));
const VolumeSnapshots = lazy(() => import("./pages/VolumeSnapshots"));
const VolumeSnapshotDetail = lazy(() => import("./pages/VolumeSnapshotDetail"));
const VolumeSnapshotClasses = lazy(() => import("./pages/VolumeSnapshotClasses"));
const VolumeSnapshotClassDetail = lazy(() => import("./pages/VolumeSnapshotClassDetail"));
const VolumeSnapshotContents = lazy(() => import("./pages/VolumeSnapshotContents"));
const VolumeSnapshotContentDetail = lazy(() => import("./pages/VolumeSnapshotContentDetail"));

// Cluster
const Nodes = lazy(() => import("./pages/Nodes"));
const NodeDetail = lazy(() => import("./pages/NodeDetail"));
const Namespaces = lazy(() => import("./pages/Namespaces"));
const NamespaceDetail = lazy(() => import("./pages/NamespaceDetail"));
const Events = lazy(() => import("./pages/Events"));
const EventDetail = lazy(() => import("./pages/EventDetail"));
const ComponentStatuses = lazy(() => import("./pages/ComponentStatuses"));
const ComponentStatusDetail = lazy(() => import("./pages/ComponentStatusDetail"));
const APIServices = lazy(() => import("./pages/APIServices"));
const APIServiceDetail = lazy(() => import("./pages/APIServiceDetail"));
const Leases = lazy(() => import("./pages/Leases"));
const LeaseDetail = lazy(() => import("./pages/LeaseDetail"));
const RuntimeClasses = lazy(() => import("./pages/RuntimeClasses"));
const RuntimeClassDetail = lazy(() => import("./pages/RuntimeClassDetail"));

// RBAC
const ServiceAccounts = lazy(() => import("./pages/ServiceAccounts"));
const ServiceAccountDetail = lazy(() => import("./pages/ServiceAccountDetail"));
const Roles = lazy(() => import("./pages/Roles"));
const RoleDetail = lazy(() => import("./pages/RoleDetail"));
const RoleBindings = lazy(() => import("./pages/RoleBindings"));
const RoleBindingDetail = lazy(() => import("./pages/RoleBindingDetail"));
const ClusterRoles = lazy(() => import("./pages/ClusterRoles"));
const ClusterRoleDetail = lazy(() => import("./pages/ClusterRoleDetail"));
const ClusterRoleBindings = lazy(() => import("./pages/ClusterRoleBindings"));
const ClusterRoleBindingDetail = lazy(() => import("./pages/ClusterRoleBindingDetail"));
const PodSecurityPolicies = lazy(() => import("./pages/PodSecurityPolicies"));
const PodSecurityPolicyDetail = lazy(() => import("./pages/PodSecurityPolicyDetail"));

// Autoscaling & Resource Management
const HorizontalPodAutoscalers = lazy(() => import("./pages/HorizontalPodAutoscalers"));
const HorizontalPodAutoscalerDetail = lazy(() => import("./pages/HorizontalPodAutoscalerDetail"));
const VerticalPodAutoscalers = lazy(() => import("./pages/VerticalPodAutoscalers"));
const VerticalPodAutoscalerDetail = lazy(() => import("./pages/VerticalPodAutoscalerDetail"));
const PodDisruptionBudgets = lazy(() => import("./pages/PodDisruptionBudgets"));
const PodDisruptionBudgetDetail = lazy(() => import("./pages/PodDisruptionBudgetDetail"));
const ResourceQuotas = lazy(() => import("./pages/ResourceQuotas"));
const ResourceQuotaDetail = lazy(() => import("./pages/ResourceQuotaDetail"));
const LimitRanges = lazy(() => import("./pages/LimitRanges"));
const LimitRangeDetail = lazy(() => import("./pages/LimitRangeDetail"));
const PriorityClasses = lazy(() => import("./pages/PriorityClasses"));
const PriorityClassDetail = lazy(() => import("./pages/PriorityClassDetail"));

// Custom Resources & Admission Control
const CustomResourceDefinitions = lazy(() => import("./pages/CustomResourceDefinitions"));
const CustomResourceDefinitionDetail = lazy(() => import("./pages/CustomResourceDefinitionDetail"));
const CustomResources = lazy(() => import("./pages/CustomResources"));
const MutatingWebhooks = lazy(() => import("./pages/MutatingWebhooks"));
const MutatingWebhookDetail = lazy(() => import("./pages/MutatingWebhookDetail"));
const ValidatingWebhooks = lazy(() => import("./pages/ValidatingWebhooks"));
const ValidatingWebhookDetail = lazy(() => import("./pages/ValidatingWebhookDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Topology = lazy(() => import("./pages/Topology"));

// Analytics Dashboards
const AnalyticsOverview = lazy(() => import("./pages/AnalyticsOverview").then(m => ({ default: m.AnalyticsOverview })));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard").then(m => ({ default: m.SecurityDashboard })));
const MLAnalyticsDashboard = lazy(() => import("./pages/MLAnalyticsDashboard").then(m => ({ default: m.MLAnalyticsDashboard })));
const CostDashboard = lazy(() => import("./pages/CostDashboard").then(m => ({ default: m.CostDashboard })));

// Layout
import { AppLayout } from "./components/layout/AppLayout";

const queryClient = new QueryClient();

// Protected route wrapper - requires active cluster connection.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { activeCluster, appMode } = useClusterStore();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Wait for zustand persistence to hydrate
    const checkHydration = () => {
      if (useClusterStore.persist.hasHydrated()) {
        setIsHydrated(true);
      } else {
        setTimeout(checkHydration, 50);
      }
    };
    checkHydration();
  }, []);

  if (!isHydrated) return <PageLoader />;
  if (!activeCluster) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Initial navigation logic: Mode Selection -> Connection -> Dashboard
function ModeSelectionEntryPoint() {
  const { appMode, activeCluster } = useClusterStore();

  // If already connected, go to home (the primary hub)
  if (activeCluster) return <Navigate to="/home" replace />;

  // If mode selected but not connected, go to connect page
  if (appMode) return <Navigate to="/connect" replace />;

  // Default: Choose mode
  return <ModeSelection />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AIAssistant />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Entry Point - Mode Selection or Cluster Connection */}
            <Route path="/" element={<ModeSelectionEntryPoint />} />
            <Route path="/mode-selection" element={<ModeSelection />} />
            <Route path="/connect" element={<ClusterConnect />} />

            {/* Apply cluster from Connect and redirect to dashboard (avoids ProtectedRoute timing) */}
            <Route path="/connected" element={<ConnectedRedirect />} />

            {/* Setup Flow - Kubeconfig & Cluster Selection */}
            <Route path="/setup/kubeconfig" element={<KubeConfigSetup />} />
            <Route path="/setup/clusters" element={<ClusterSelection />} />

            {/* Protected App Routes - Require Cluster Connection */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/home" element={<HomePage />} />
              <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/audit-log" element={<AuditLog />} />

              {/* Analytics Dashboards */}
              <Route path="/analytics" element={<AnalyticsOverview />} />
              <Route path="/security" element={<SecurityDashboard />} />
              <Route path="/ml-analytics" element={<MLAnalyticsDashboard />} />
              <Route path="/cost" element={<CostDashboard />} />

              {/* Cluster Topology */}
              <Route path="/topology" element={<Topology />} />

              {/* Workloads */}
              <Route path="/workloads" element={<WorkloadsOverview />} />
              <Route path="/pods" element={<Pods />} />
              <Route path="/pods/:namespace/:name" element={<PodDetail />} />
              <Route path="/deployments" element={<Deployments />} />
              <Route path="/deployments/:namespace/:name" element={<DeploymentDetail />} />
              <Route path="/replicasets" element={<ReplicaSets />} />
              <Route path="/replicasets/:namespace/:name" element={<ReplicaSetDetail />} />
              <Route path="/statefulsets" element={<StatefulSets />} />
              <Route path="/statefulsets/:namespace/:name" element={<StatefulSetDetail />} />
              <Route path="/daemonsets" element={<DaemonSets />} />
              <Route path="/daemonsets/:namespace/:name" element={<DaemonSetDetail />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:namespace/:name" element={<JobDetail />} />
              <Route path="/cronjobs" element={<CronJobs />} />
              <Route path="/cronjobs/:namespace/:name" element={<CronJobDetail />} />
              <Route path="/replicationcontrollers" element={<ReplicationControllers />} />
              <Route path="/replicationcontrollers/:namespace/:name" element={<ReplicationControllerDetail />} />
              <Route path="/replication-controllers/:namespace/:name" element={<ReplicationControllerDetail />} />
              <Route path="/podtemplates" element={<PodTemplates />} />
              <Route path="/podtemplates/:namespace/:name" element={<PodTemplateDetail />} />
              <Route path="/controllerrevisions" element={<ControllerRevisions />} />
              <Route path="/controllerrevisions/:namespace/:name" element={<ControllerRevisionDetail />} />
              <Route path="/resourceslices" element={<ResourceSlices />} />
              <Route path="/resourceslices/:name" element={<ResourceSliceDetail />} />
              <Route path="/deviceclasses" element={<DeviceClasses />} />
              <Route path="/deviceclasses/:name" element={<DeviceClassDetail />} />
              <Route path="/device-classes" element={<DeviceClasses />} />
              <Route path="/device-classes/:name" element={<DeviceClassDetail />} />
              <Route path="/ipaddresspools" element={<IPAddressPools />} />
              <Route path="/ipaddresspools/:namespace/:name" element={<IPAddressPoolDetail />} />
              <Route path="/bgppeers" element={<BGPPeers />} />
              <Route path="/bgppeers/:namespace/:name" element={<BGPPeerDetail />} />

              {/* Networking */}
              <Route path="/services" element={<Services />} />
              <Route path="/services/:namespace/:name" element={<ServiceDetail />} />
              <Route path="/endpoints" element={<Endpoints />} />
              <Route path="/endpoints/:namespace/:name" element={<EndpointDetail />} />
              <Route path="/endpointslices" element={<EndpointSlices />} />
              <Route path="/endpointslices/:namespace/:name" element={<EndpointSliceDetail />} />
              <Route path="/ingresses" element={<Ingresses />} />
              <Route path="/ingresses/:namespace/:name" element={<IngressDetail />} />
              <Route path="/ingressclasses" element={<IngressClasses />} />
              <Route path="/ingressclasses/:name" element={<IngressClassDetail />} />
              <Route path="/networkpolicies" element={<NetworkPolicies />} />
              <Route path="/networkpolicies/:namespace/:name" element={<NetworkPolicyDetail />} />

              {/* Storage & Config */}
              <Route path="/configmaps" element={<ConfigMaps />} />
              <Route path="/configmaps/:namespace/:name" element={<ConfigMapDetail />} />
              <Route path="/secrets" element={<Secrets />} />
              <Route path="/secrets/:namespace/:name" element={<SecretDetail />} />
              <Route path="/persistentvolumes" element={<PersistentVolumes />} />
              <Route path="/persistentvolumes/:name" element={<PersistentVolumeDetail />} />
              <Route path="/persistentvolumeclaims" element={<PersistentVolumeClaims />} />
              <Route path="/persistentvolumeclaims/:namespace/:name" element={<PersistentVolumeClaimDetail />} />
              <Route path="/storageclasses" element={<StorageClasses />} />
              <Route path="/storageclasses/:name" element={<StorageClassDetail />} />
              <Route path="/volumeattachments" element={<VolumeAttachments />} />
              <Route path="/volumeattachments/:name" element={<VolumeAttachmentDetail />} />
              <Route path="/volumesnapshots" element={<VolumeSnapshots />} />
              <Route path="/volumesnapshots/:namespace/:name" element={<VolumeSnapshotDetail />} />
              <Route path="/volume-snapshots" element={<VolumeSnapshots />} />
              <Route path="/volume-snapshots/:namespace/:name" element={<VolumeSnapshotDetail />} />
              <Route path="/volumesnapshotclasses" element={<VolumeSnapshotClasses />} />
              <Route path="/volumesnapshotclasses/:name" element={<VolumeSnapshotClassDetail />} />
              <Route path="/volume-snapshot-classes" element={<VolumeSnapshotClasses />} />
              <Route path="/volume-snapshot-classes/:name" element={<VolumeSnapshotClassDetail />} />
              <Route path="/volumesnapshotcontents" element={<VolumeSnapshotContents />} />
              <Route path="/volumesnapshotcontents/:name" element={<VolumeSnapshotContentDetail />} />
              <Route path="/volume-snapshot-contents" element={<VolumeSnapshotContents />} />
              <Route path="/volume-snapshot-contents/:name" element={<VolumeSnapshotContentDetail />} />

              {/* Cluster */}
              <Route path="/nodes" element={<Nodes />} />
              <Route path="/nodes/:name" element={<NodeDetail />} />
              <Route path="/namespaces" element={<Namespaces />} />
              <Route path="/namespaces/:name" element={<NamespaceDetail />} />
              <Route path="/events" element={<Events />} />
              <Route path="/events/:namespace/:name" element={<EventDetail />} />
              <Route path="/componentstatuses" element={<ComponentStatuses />} />
              <Route path="/componentstatuses/:name" element={<ComponentStatusDetail />} />
              <Route path="/component-statuses/:name" element={<ComponentStatusDetail />} />
              <Route path="/apiservices" element={<APIServices />} />
              <Route path="/apiservices/:name" element={<APIServiceDetail />} />
              <Route path="/leases" element={<Leases />} />
              <Route path="/leases/:namespace/:name" element={<LeaseDetail />} />
              <Route path="/runtimeclasses" element={<RuntimeClasses />} />
              <Route path="/runtimeclasses/:name" element={<RuntimeClassDetail />} />
              <Route path="/runtime-classes/:name" element={<RuntimeClassDetail />} />

              {/* RBAC */}
              <Route path="/serviceaccounts" element={<ServiceAccounts />} />
              <Route path="/serviceaccounts/:namespace/:name" element={<ServiceAccountDetail />} />
              <Route path="/roles" element={<Roles />} />
              <Route path="/roles/:namespace/:name" element={<RoleDetail />} />
              <Route path="/rolebindings" element={<RoleBindings />} />
              <Route path="/rolebindings/:namespace/:name" element={<RoleBindingDetail />} />
              <Route path="/clusterroles" element={<ClusterRoles />} />
              <Route path="/clusterroles/:name" element={<ClusterRoleDetail />} />
              <Route path="/clusterrolebindings" element={<ClusterRoleBindings />} />
              <Route path="/clusterrolebindings/:name" element={<ClusterRoleBindingDetail />} />
              <Route path="/podsecuritypolicies" element={<PodSecurityPolicies />} />
              <Route path="/podsecuritypolicies/:name" element={<PodSecurityPolicyDetail />} />
              <Route path="/pod-security-policies/:name" element={<PodSecurityPolicyDetail />} />

              {/* Autoscaling & Resource Management */}
              <Route path="/horizontalpodautoscalers" element={<HorizontalPodAutoscalers />} />
              <Route path="/horizontalpodautoscalers/:namespace/:name" element={<HorizontalPodAutoscalerDetail />} />
              <Route path="/verticalpodautoscalers" element={<VerticalPodAutoscalers />} />
              <Route path="/verticalpodautoscalers/:namespace/:name" element={<VerticalPodAutoscalerDetail />} />
              <Route path="/poddisruptionbudgets" element={<PodDisruptionBudgets />} />
              <Route path="/poddisruptionbudgets/:namespace/:name" element={<PodDisruptionBudgetDetail />} />
              <Route path="/resourcequotas" element={<ResourceQuotas />} />
              <Route path="/resourcequotas/:namespace/:name" element={<ResourceQuotaDetail />} />
              <Route path="/limitranges" element={<LimitRanges />} />
              <Route path="/limitranges/:namespace/:name" element={<LimitRangeDetail />} />
              <Route path="/priorityclasses" element={<PriorityClasses />} />
              <Route path="/priorityclasses/:name" element={<PriorityClassDetail />} />

              {/* Custom Resources & Admission Control */}
              <Route path="/customresourcedefinitions" element={<CustomResourceDefinitions />} />
              <Route path="/customresourcedefinitions/:name" element={<CustomResourceDefinitionDetail />} />
              <Route path="/custom-resource-definitions/:name" element={<CustomResourceDefinitionDetail />} />
              <Route path="/customresources" element={<CustomResources />} />
              <Route path="/mutatingwebhooks" element={<MutatingWebhooks />} />
              <Route path="/mutatingwebhooks/:name" element={<MutatingWebhookDetail />} />
              <Route path="/validatingwebhooks" element={<ValidatingWebhooks />} />
              <Route path="/validatingwebhooks/:name" element={<ValidatingWebhookDetail />} />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
