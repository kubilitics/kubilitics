import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  Home,
  LayoutDashboard,
  Box,
  Layers,
  Server,
  Globe,
  Database,
  Settings,
  Shield,
  Activity,
  History,
  Network,
  FileText,
  ChevronRight,
  ChevronLeft,
  Key,
  Scale,
  Route,
  HardDrive,
  Users,
  Gauge,
  FileCode,
  Webhook,
  AlertTriangle,
  Container,
  Clock,
  Loader2,
  Cpu,
  Lock,
  Zap,
  Camera,
  ClipboardList,
  HardDrive as StorageIcon
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useResourceCounts } from '@/hooks/useResourceCounts';
import { useMetalLBInstalled } from '@/hooks/useMetalLBInstalled';

const SIDEBAR_COLLAPSED_KEY = 'kubilitics-sidebar-collapsed';

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  count?: number;
  /** Optional callback when item is clicked to ensure parent section is expanded */
  onNavigate?: () => void;
}

function NavItem({ to, icon: Icon, label, count, onNavigate }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative overflow-hidden',
        isActive
          ? 'text-primary bg-primary/5'
          : 'text-foreground hover:bg-muted/50'
      )}
    >
      {/* Active Indicator Line */}
      {isActive && (
        <motion.div
          layoutId="activeNavLine"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r-full bg-primary"
        />
      )}

      <Icon className={cn("h-5 w-5 transition-colors relative z-10", isActive ? "text-primary fill-primary/10" : "text-foreground/80 group-hover:text-foreground")} />
      <span className={cn("flex-1 truncate relative z-10", isActive && "font-semibold")}>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'text-xs font-bold px-2 py-0.5 rounded-full min-w-[1.5rem] text-center shadow-sm leading-none transition-colors relative z-10',
            isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/90 group-hover:bg-muted-foreground/20'
          )}
        >
          {count}
        </span>
      )}
    </NavLink>
  );
}

interface NavGroupProps {
  label: string;
  sectionId: string;
  children: React.ReactNode;
  icon: React.ElementType;
  /** When true, show the same blue gradient highlight as Dashboard/Settings */
  isSectionActive?: boolean;
  /** Controlled: whether this section is currently open */
  isOpen: boolean;
  /** Optional route to navigate to when header is clicked */
  to?: string;
  /** Callback when section header is clicked */
  onToggle: (sectionId: string) => void;
}

function NavGroup({ label, sectionId, children, icon: Icon, isSectionActive = false, isOpen, to, onToggle }: NavGroupProps) {
  const headerContent = (
    <div className={cn(
      "flex items-center justify-between w-full px-4 py-3 rounded-xl transition-all duration-300 group shadow-sm border",
      isSectionActive
        ? "bg-gradient-to-r from-primary to-blue-600 text-primary-foreground shadow-lg shadow-blue-500/20 border-transparent"
        : isOpen
          ? "bg-muted/50 text-foreground border-border/50"
          : "bg-card hover:bg-muted/50 text-foreground border-transparent hover:border-border/50"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "p-1.5 rounded-lg transition-colors",
          isSectionActive ? "bg-primary-foreground/20 text-primary-foreground" : isOpen ? "bg-muted text-foreground" : "bg-muted text-foreground/90 group-hover:bg-background group-hover:text-foreground"
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={cn(
          "text-base font-normal tracking-wide uppercase",
          isSectionActive ? "text-primary-foreground" : "text-foreground"
        )}>
          {label}
        </span>
      </div>
      <ChevronRight
        className={cn('h-5 w-5 transition-transform duration-300', isSectionActive ? 'text-primary-foreground' : 'text-foreground/80 group-hover:text-foreground', isOpen && 'rotate-90')}
      />
    </div>
  );

  return (
    <div className="space-y-1">
      {to ? (
        <NavLink
          to={to}
          onClick={() => onToggle(sectionId)}
          className="block"
        >
          {headerContent}
        </NavLink>
      ) : (
        <button
          onClick={() => onToggle(sectionId)}
          aria-expanded={isOpen}
          aria-controls={`nav-group-${sectionId}`}
          className="w-full"
        >
          {headerContent}
        </button>
      )}

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={`nav-group-${sectionId}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="relative pl-4 ml-4 border-l-2 border-primary/20 my-2 space-y-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItemIconOnly({
  to,
  icon: Icon,
  label,
  iconColor,
}: {
  to: string;
  icon: React.ElementType;
  label: string;
  /** Tailwind class for icon color when inactive (e.g. text-blue-600) */
  iconColor?: string;
}) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <NavLink
      to={to}
      className={cn(
        'flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:scale-105 active:scale-95 group relative border',
        isActive
          ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 border-transparent'
          : 'hover:bg-muted/80 border-transparent hover:border-border/50'
      )}
      title={label}
      aria-label={label}
    >
      <Icon
        className={cn(
          'h-6 w-6 transition-colors',
          isActive
            ? 'text-primary-foreground fill-primary-foreground/20'
            : iconColor || 'text-foreground group-hover:text-foreground'
        )}
        aria-hidden
      />

      {/* Tooltip-like label on hover for icon-only mode */}
      <span className="absolute left-full ml-3 px-3 py-1.5 bg-popover text-popover-foreground text-sm font-medium rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-border">
        {label}
      </span>
    </NavLink>
  );
}

function isPathIn(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Shows "Syncing resources..." for max 10s to avoid endless loading when queries hang */
function SyncingIndicator({ isLoading }: { isLoading: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isLoading) {
      setShow(true);
      const id = setTimeout(() => setShow(false), 10000);
      return () => clearTimeout(id);
    } else {
      setShow(false);
    }
  }, [isLoading]);
  if (!isLoading || !show) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-blue-600 bg-blue-50/50 dark:bg-blue-950/30 dark:text-blue-400 rounded-lg animate-pulse border border-blue-100 dark:border-blue-900/50">
      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      <span>Syncing resources...</span>
    </div>
  );
}

const WORKLOAD_PATHS = ['/pods', '/deployments', '/replicasets', '/statefulsets', '/daemonsets', '/jobs', '/cronjobs', '/podtemplates', '/controllerrevisions', '/resourceslices', '/deviceclasses', '/device-classes'];
const NETWORKING_PATHS = ['/services', '/ingresses', '/ingressclasses', '/endpoints', '/endpointslices', '/networkpolicies', '/ipaddresspools', '/bgppeers'];
const STORAGE_PATHS = ['/configmaps', '/secrets', '/persistentvolumes', '/persistentvolumeclaims', '/storageclasses', '/volumeattachments', '/volumesnapshots', '/volume-snapshots', '/volumesnapshotclasses', '/volume-snapshot-classes', '/volumesnapshotcontents', '/volume-snapshot-contents'];
const CLUSTER_PATHS = ['/nodes', '/namespaces', '/events', '/apiservices', '/leases'];
const SECURITY_PATHS = ['/serviceaccounts', '/roles', '/clusterroles', '/rolebindings', '/clusterrolebindings', '/priorityclasses'];
const RESOURCES_PATHS = ['/resourcequotas', '/limitranges'];
const SCALING_PATHS = ['/horizontalpodautoscalers', '/verticalpodautoscalers', '/poddisruptionbudgets'];
const CRD_PATHS = ['/customresourcedefinitions', '/customresources'];
const ADMISSION_PATHS = ['/mutatingwebhooks', '/validatingwebhooks'];

// Section identifiers for accordion state management
const SECTION_IDS = {
  WORKLOADS: 'workloads',
  NETWORKING: 'networking',
  STORAGE: 'storage',
  CLUSTER: 'cluster',
  SECURITY: 'security',
  RESOURCES: 'resources',
  SCALING: 'scaling',
  CRDS: 'crds',
  ADMISSION: 'admission',
} as const;

type SectionId = typeof SECTION_IDS[keyof typeof SECTION_IDS] | null;

// Map route paths to their parent section IDs
function getSectionForPath(pathname: string): SectionId {
  if (pathname === '/workloads' || isPathIn(pathname, WORKLOAD_PATHS)) return SECTION_IDS.WORKLOADS;
  if (isPathIn(pathname, NETWORKING_PATHS)) return SECTION_IDS.NETWORKING;
  if (isPathIn(pathname, STORAGE_PATHS)) return SECTION_IDS.STORAGE;
  if (isPathIn(pathname, CLUSTER_PATHS)) return SECTION_IDS.CLUSTER;
  if (isPathIn(pathname, SECURITY_PATHS)) return SECTION_IDS.SECURITY;
  if (isPathIn(pathname, RESOURCES_PATHS)) return SECTION_IDS.RESOURCES;
  if (isPathIn(pathname, SCALING_PATHS)) return SECTION_IDS.SCALING;
  if (isPathIn(pathname, CRD_PATHS)) return SECTION_IDS.CRDS;
  if (isPathIn(pathname, ADMISSION_PATHS)) return SECTION_IDS.ADMISSION;
  return null; // Dashboard, Settings, etc.
}

function SidebarContent({
  counts,
  isLoading,
  metallbInstalled,
}: {
  counts: ReturnType<typeof useResourceCounts>['counts'];
  isLoading: boolean;
  metallbInstalled: boolean;
}) {
  const location = useLocation();
  const pathname = location.pathname;
  const isHomeActive = pathname === '/home';
  const isDashboardActive = pathname === '/dashboard';
  const isTopologyActive = pathname === '/topology';

  // Centralized state for accordion: track which section is currently open
  const [openSection, setOpenSection] = useState<SectionId>(() => {
    // Initialize based on current route
    const sectionForPath = getSectionForPath(pathname);
    return sectionForPath;
  });

  // Sync expansion state with route changes
  useEffect(() => {
    const sectionForPath = getSectionForPath(pathname);
    // If on dashboard, close all sections; otherwise open the section for current route
    setOpenSection(sectionForPath);
  }, [pathname]);

  // Handle section toggle: if clicking the same section, close it; otherwise open new and close others
  const handleSectionToggle = (sectionId: string) => {
    setOpenSection((current) => {
      // If clicking the already-open section, close it
      if (current === sectionId) {
        return null;
      }
      // Otherwise, open the clicked section (this closes any other open section)
      return sectionId as SectionId;
    });
  };

  // Handle NavItem click: ensure parent section is expanded
  const handleNavItemClick = (sectionId: SectionId) => {
    if (sectionId && openSection !== sectionId) {
      setOpenSection(sectionId);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-6 w-full">
      <div className="space-y-1.5">
        <NavLink
          to="/home"
          className={cn(
            "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group border shadow-sm",
            isHomeActive
              ? "bg-gradient-to-r from-primary to-blue-600 text-primary-foreground shadow-lg shadow-blue-500/20 border-transparent"
              : "bg-card text-foreground hover:bg-muted/50 border-transparent hover:border-border/50"
          )}
        >
          <Home className="h-6 w-6" />
          <span className="font-normal text-base">Home</span>
        </NavLink>
        <NavLink
          to="/dashboard"
          className={cn(
            "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group border shadow-sm",
            isDashboardActive
              ? "bg-gradient-to-r from-primary to-blue-600 text-primary-foreground shadow-lg shadow-blue-500/20 border-transparent"
              : "bg-card text-foreground hover:bg-muted/50 border-transparent hover:border-border/50"
          )}
        >
          <LayoutDashboard className="h-6 w-6" />
          <span className="font-normal text-base">Dashboard</span>
        </NavLink>
        <NavLink
          to="/topology"
          className={cn(
            "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group border shadow-sm",
            isTopologyActive
              ? "bg-gradient-to-r from-primary to-blue-600 text-primary-foreground shadow-lg shadow-blue-500/20 border-transparent"
              : "bg-card text-foreground hover:bg-muted/50 border-transparent hover:border-border/50"
          )}
        >
          <Network className="h-6 w-6" />
          <span className="font-normal text-base">Topology</span>
        </NavLink>
      </div>

      {/* Connection indicator — cap display at 10s to avoid endless "Syncing" when queries hang */}
      <SyncingIndicator isLoading={isLoading} />

      <div className="space-y-5">
        {/* Workloads */}
        <NavGroup
          label="Workloads"
          sectionId={SECTION_IDS.WORKLOADS}
          to="/workloads"
          icon={Cpu}
          isOpen={openSection === SECTION_IDS.WORKLOADS}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, WORKLOAD_PATHS) || pathname === '/workloads'}
        >
          <NavItem to="/pods" icon={Box} label="Pods" count={counts.pods} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/deployments" icon={Container} label="Deployments" count={counts.deployments} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/replicasets" icon={Layers} label="ReplicaSets" count={counts.replicasets} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/statefulsets" icon={Layers} label="StatefulSets" count={counts.statefulsets} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/daemonsets" icon={Layers} label="DaemonSets" count={counts.daemonsets} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/jobs" icon={Activity} label="Jobs" count={counts.jobs} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/cronjobs" icon={Clock} label="CronJobs" count={counts.cronjobs} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/podtemplates" icon={Layers} label="Pod Templates" count={counts.podtemplates} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/controllerrevisions" icon={History} label="Controller Revisions" count={counts.controllerrevisions} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/resourceslices" icon={Cpu} label="Resource Slices" count={counts.resourceslices} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
          <NavItem to="/deviceclasses" icon={Cpu} label="Device Classes" count={counts.deviceclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.WORKLOADS)} />
        </NavGroup>

        {/* Networking */}
        <NavGroup
          label="Networking"
          sectionId={SECTION_IDS.NETWORKING}
          icon={Globe}
          isOpen={openSection === SECTION_IDS.NETWORKING}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, NETWORKING_PATHS)}
        >
          <NavItem to="/services" icon={Globe} label="Services" count={counts.services} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/ingresses" icon={Globe} label="Ingresses" count={counts.ingresses} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/ingressclasses" icon={Route} label="Ingress Classes" count={counts.ingressclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/endpoints" icon={Globe} label="Endpoints" count={counts.endpoints} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/endpointslices" icon={Network} label="Endpoint Slices" count={counts.endpointslices} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          <NavItem to="/networkpolicies" icon={Shield} label="Network Policies" count={counts.networkpolicies} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
          {metallbInstalled && (
            <>
              <NavItem to="/ipaddresspools" icon={Network} label="IP Address Pools" count={counts.ipaddresspools} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
              <NavItem to="/bgppeers" icon={Network} label="BGP Peers" count={counts.bgppeers} onNavigate={() => handleNavItemClick(SECTION_IDS.NETWORKING)} />
            </>
          )}
        </NavGroup>

        {/* Storage */}
        <NavGroup
          label="Storage"
          sectionId={SECTION_IDS.STORAGE}
          icon={StorageIcon}
          isOpen={openSection === SECTION_IDS.STORAGE}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, STORAGE_PATHS)}
        >
          <NavItem to="/configmaps" icon={Settings} label="ConfigMaps" count={counts.configmaps} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/secrets" icon={Key} label="Secrets" count={counts.secrets} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/persistentvolumes" icon={HardDrive} label="Persistent Volumes" count={counts.persistentvolumes} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/persistentvolumeclaims" icon={Database} label="PVCs" count={counts.persistentvolumeclaims} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/storageclasses" icon={Database} label="Storage Classes" count={counts.storageclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumeattachments" icon={HardDrive} label="Volume Attachments" count={counts.volumeattachments} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumesnapshots" icon={Camera} label="Volume Snapshots" count={counts.volumesnapshots} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumesnapshotclasses" icon={Camera} label="Snapshot Classes" count={counts.volumesnapshotclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
          <NavItem to="/volumesnapshotcontents" icon={HardDrive} label="Snapshot Contents" count={counts.volumesnapshotcontents} onNavigate={() => handleNavItemClick(SECTION_IDS.STORAGE)} />
        </NavGroup>

        {/* Cluster */}
        <NavGroup
          label="Cluster"
          sectionId={SECTION_IDS.CLUSTER}
          icon={Server}
          isOpen={openSection === SECTION_IDS.CLUSTER}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, CLUSTER_PATHS)}
        >
          <NavItem to="/nodes" icon={Server} label="Nodes" count={counts.nodes} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/namespaces" icon={FileText} label="Namespaces" count={counts.namespaces} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/events" icon={Activity} label="Events" onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/apiservices" icon={FileCode} label="API Services" count={counts.apiservices} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
          <NavItem to="/leases" icon={Activity} label="Leases" count={counts.leases} onNavigate={() => handleNavItemClick(SECTION_IDS.CLUSTER)} />
        </NavGroup>

        {/* Security & Access */}
        <NavGroup
          label="Security"
          sectionId={SECTION_IDS.SECURITY}
          icon={Lock}
          isOpen={openSection === SECTION_IDS.SECURITY}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, SECURITY_PATHS)}
        >
          <NavItem to="/serviceaccounts" icon={Users} label="Service Accounts" count={counts.serviceaccounts} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/roles" icon={Shield} label="Roles" count={counts.roles} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/clusterroles" icon={Shield} label="Cluster Roles" count={counts.clusterroles} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/rolebindings" icon={Shield} label="Role Bindings" count={counts.rolebindings} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/clusterrolebindings" icon={Shield} label="Cluster Role Bindings" count={counts.clusterrolebindings} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
          <NavItem to="/priorityclasses" icon={AlertTriangle} label="Priority Classes" count={counts.priorityclasses} onNavigate={() => handleNavItemClick(SECTION_IDS.SECURITY)} />
        </NavGroup>

        {/* Resource Management */}
        <NavGroup
          label="Resources"
          sectionId={SECTION_IDS.RESOURCES}
          icon={Gauge}
          isOpen={openSection === SECTION_IDS.RESOURCES}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, RESOURCES_PATHS)}
        >
          <NavItem to="/resourcequotas" icon={Gauge} label="Resource Quotas" count={counts.resourcequotas} onNavigate={() => handleNavItemClick(SECTION_IDS.RESOURCES)} />
          <NavItem to="/limitranges" icon={Scale} label="Limit Ranges" count={counts.limitranges} onNavigate={() => handleNavItemClick(SECTION_IDS.RESOURCES)} />
        </NavGroup>

        {/* Scaling & Policies */}
        <NavGroup
          label="Scaling"
          sectionId={SECTION_IDS.SCALING}
          icon={Zap}
          isOpen={openSection === SECTION_IDS.SCALING}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, SCALING_PATHS)}
        >
          <NavItem to="/horizontalpodautoscalers" icon={Scale} label="HPAs" count={counts.horizontalpodautoscalers} onNavigate={() => handleNavItemClick(SECTION_IDS.SCALING)} />
          <NavItem to="/verticalpodautoscalers" icon={Scale} label="VPAs" count={counts.verticalpodautoscalers} onNavigate={() => handleNavItemClick(SECTION_IDS.SCALING)} />
          <NavItem to="/poddisruptionbudgets" icon={Shield} label="PDBs" count={counts.poddisruptionbudgets} onNavigate={() => handleNavItemClick(SECTION_IDS.SCALING)} />
        </NavGroup>

        {/* Custom Resources */}
        <NavGroup
          label="CRDs"
          sectionId={SECTION_IDS.CRDS}
          icon={FileCode}
          isOpen={openSection === SECTION_IDS.CRDS}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, CRD_PATHS)}
        >
          <NavItem to="/customresourcedefinitions" icon={FileCode} label="Definitions" count={counts.customresourcedefinitions} onNavigate={() => handleNavItemClick(SECTION_IDS.CRDS)} />
          <NavItem to="/customresources" icon={FileCode} label="Instances" onNavigate={() => handleNavItemClick(SECTION_IDS.CRDS)} />
        </NavGroup>

        {/* Admission Control */}
        <NavGroup
          label="Admission"
          sectionId={SECTION_IDS.ADMISSION}
          icon={Webhook}
          isOpen={openSection === SECTION_IDS.ADMISSION}
          onToggle={handleSectionToggle}
          isSectionActive={isPathIn(pathname, ADMISSION_PATHS)}
        >
          <NavItem to="/mutatingwebhooks" icon={Webhook} label="Mutating Webhooks" count={counts.mutatingwebhookconfigurations} onNavigate={() => handleNavItemClick(SECTION_IDS.ADMISSION)} />
          <NavItem to="/validatingwebhooks" icon={Webhook} label="Validating Webhooks" count={counts.validatingwebhookconfigurations} onNavigate={() => handleNavItemClick(SECTION_IDS.ADMISSION)} />
        </NavGroup>
      </div>
    </div>
  );
}

const SECTION_ROUTES = ['/workloads', '/topology', ...WORKLOAD_PATHS, ...NETWORKING_PATHS, ...STORAGE_PATHS, ...CLUSTER_PATHS, ...SECURITY_PATHS, ...RESOURCES_PATHS, ...SCALING_PATHS, ...CRD_PATHS, ...ADMISSION_PATHS];


export function Sidebar() {
  const { counts, isLoading } = useResourceCounts();
  const { installed: metallbInstalled } = useMetalLBInstalled();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const location = useLocation();
  const pathname = location.pathname;
  const isSettingsActive = pathname.startsWith('/settings');

  // Expand sidebar when navigating to a section route (e.g. Workloads) so user sees full nav
  useEffect(() => {
    const isSectionRoute = SECTION_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (isSectionRoute && collapsed) {
      setCollapsed(false);
    }
  }, [pathname, collapsed, setCollapsed]);

  const fullContent = (
    <div className="flex flex-col flex-1 min-h-0 bg-sidebar/30">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 scrollbar-thin scrollbar-thumb-border/40 hover:scrollbar-thumb-border/80">
        <SidebarContent counts={counts} isLoading={isLoading} metallbInstalled={metallbInstalled} />
      </div>

      {/* Fixed footer: Audit Log + Settings + Collapse — always visible at bottom */}
      <div className="shrink-0 px-5 pb-4 pt-2 border-t border-border/60 space-y-1.5">
        {/* Audit Log — E-PLAT-003 */}
        <NavLink
          to="/audit-log"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group border shadow-sm",
              isActive
                ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/20 border-transparent"
                : "bg-card text-foreground hover:bg-muted/50 border-transparent hover:border-border/50"
            )
          }
        >
          {({ isActive }) => (
            <>
              <ClipboardList className={cn("h-5 w-5 transition-colors shrink-0", isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground")} />
              <span className="font-normal text-sm">Audit Log</span>
            </>
          )}
        </NavLink>
        <NavLink
          to="/settings"
          className={cn(
            "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 group border shadow-sm",
            isSettingsActive
              ? "bg-gradient-to-r from-primary to-blue-600 text-primary-foreground shadow-lg shadow-blue-500/20 border-transparent"
              : "bg-card text-foreground hover:bg-muted/50 border-transparent hover:border-border/50"
          )}
        >
          <Settings className={cn("h-6 w-6 transition-colors shrink-0", isSettingsActive ? "text-primary-foreground" : "text-foreground/80 group-hover:text-foreground")} />
          <span className="font-normal text-base">Settings</span>
        </NavLink>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className={cn(
              "flex items-center justify-start gap-3 w-full px-4 py-3.5 rounded-xl border shadow-sm transition-all duration-200 group",
              "bg-card text-foreground hover:bg-muted/50 border-transparent hover:border-border/50"
            )}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-6 w-6 transition-transform group-hover:-translate-x-0.5 shrink-0" aria-hidden />
            <span className="font-normal text-base">Collapse Sidebar</span>
          </button>
        )}
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <>
        <aside
          className="w-[5.5rem] h-[calc(100vh-5rem)] border-r border-border/60 bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/60 flex flex-col items-center py-6 gap-4 shrink-0 z-30"
          onMouseEnter={() => setFlyoutOpen(true)}
          onMouseLeave={() => setFlyoutOpen(false)}
          aria-label="Navigation rail"
        >
          <NavItemIconOnly to="/dashboard" icon={LayoutDashboard} label="Dashboard" iconColor="text-blue-600 group-hover:text-blue-700" />
          <NavItemIconOnly to="/topology" icon={Network} label="Topology" iconColor="text-violet-600 group-hover:text-violet-700" />
          <NavItemIconOnly to="/workloads" icon={Cpu} label="Workloads" iconColor="text-amber-600 group-hover:text-amber-700" />
          <div className="w-12 h-px bg-border/50 my-2" />
          <NavItemIconOnly to="/pods" icon={Box} label="Pods" iconColor="text-emerald-600 group-hover:text-emerald-700" />
          <NavItemIconOnly to="/nodes" icon={Server} label="Nodes" iconColor="text-sky-600 group-hover:text-sky-700" />
          <NavItemIconOnly to="/services" icon={Globe} label="Services" iconColor="text-cyan-600 group-hover:text-cyan-700" />
          <NavItemIconOnly to="/events" icon={Activity} label="Events" iconColor="text-amber-600 group-hover:text-amber-700" />

          <div className="flex-1" />

          <NavItemIconOnly to="/audit-log" icon={ClipboardList} label="Audit Log" iconColor="text-indigo-600 group-hover:text-indigo-700" />
          <NavItemIconOnly to="/settings" icon={Settings} label="Settings" iconColor="text-slate-600 group-hover:text-slate-700" />
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex items-center justify-center w-11 h-11 rounded-xl text-blue-600 hover:text-blue-700 hover:bg-blue-50/80 transition-colors mb-2"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </aside>
        <AnimatePresence>
          {flyoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="fixed left-[5.5rem] top-20 bottom-0 z-40 w-72 border-r border-border bg-sidebar/95 backdrop-blur shadow-2xl"
              onMouseEnter={() => setFlyoutOpen(true)}
              onMouseLeave={() => setFlyoutOpen(false)}
              style={{ height: 'calc(100vh - 5rem)' }}
            >
              {fullContent}
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <aside className="w-72 h-[calc(100vh-5rem)] flex flex-col border-r border-border/60 bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/60 shrink-0 transition-all duration-300">
      {fullContent}
    </aside>
  );
}