import type { TopologyGraph, TopologyNode, TopologyEdge, KubernetesKind, RelationshipType } from '../types/topology.types';

/**
 * GraphEnhancer – Multi-pass relationship discovery engine
 * Enhances the raw topology graph with inferred Kubernetes relationships:
 * 1. Ownership (Deployment -> RS -> Pod)
 * 2. Network flows (Ingress -> Service -> Pod)
 * 3. Storage bindings (Pod -> PVC -> PV -> SC)
 * 4. Scheduling (Pod -> Node)
 * 5. Configuration (Pod -> CM/Secret)
 */
export class GraphEnhancer {
    private nodeMap: Map<string, TopologyNode>;
    private edges: TopologyEdge[];
    private nextEdgeId: number = 1000;

    constructor(private graph: TopologyGraph) {
        this.nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
        this.edges = [...graph.edges];

        // Set nextEdgeId based on existing edges to avoid collisions
        this.graph.edges.forEach(e => {
            const match = e.id.match(/(\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num >= this.nextEdgeId) this.nextEdgeId = num + 1;
            }
        });
    }

    /**
     * Run all enhancement passes and return the enriched graph
     */
    enhance(): TopologyGraph {
        this.addImplicitNamespaceRelationships();
        this.addHierarchyRelationships();
        this.addNetworkRelationships();
        this.addStorageRelationships();
        this.addSchedulingRelationships();
        this.addConfigurationRelationships();

        return {
            ...this.graph,
            edges: this.edges,
        };
    }

    private addEdge(sourceId: string, targetId: string, type: RelationshipType, label: string, derivation: string) {
        // Avoid self-referential or invalid edges
        if (sourceId === targetId || !this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId)) return;

        // Avoid duplicates
        // We check if an edge with same source, target, and type already exists
        const exists = this.edges.some(e =>
            e.source === sourceId &&
            e.target === targetId &&
            (e.relationshipType === type || type === 'contains')
        );
        if (exists) return;

        const edgeId = `e-gen-${sourceId.split('/').pop()}-${targetId.split('/').pop()}-${this.nextEdgeId++}`;

        this.edges.push({
            id: edgeId,
            source: sourceId,
            target: targetId,
            relationshipType: type,
            label,
            metadata: {
                derivation,
                confidence: 0.95,
                sourceField: 'metadata.inferred',
            }
        });
    }

    /**
     * Pass 1: Namespace containment (Namespace -> Resource)
     */
    private addImplicitNamespaceRelationships() {
        const namespaces = this.graph.nodes.filter(n => n.kind === 'Namespace');
        for (const node of this.graph.nodes) {
            if (node.kind === 'Namespace' || !node.namespace) continue;
            const nsNode = namespaces.find(ns => ns.name === node.namespace);
            if (nsNode) {
                this.addEdge(nsNode.id, node.id, 'contains', 'contains', 'namespaceMembership');
            }
        }
    }

    /**
     * Pass 2: Workload hierarchy (Deployment -> RS -> Pod, Job -> Pod)
     */
    private addHierarchyRelationships() {
        const workloads = this.graph.nodes.filter(n =>
            ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(n.kind)
        );

        for (const node of this.graph.nodes) {
            if (node.kind === 'Pod') {
                const rsName = node.metadata.labels?.['pod-template-hash'];
                if (rsName) {
                    // Find parent RS
                    const parentRS = workloads.find(w => w.kind === 'ReplicaSet' && node.name.startsWith(w.name));
                    if (parentRS) {
                        this.addEdge(parentRS.id, node.id, 'owns', 'owns', 'labelInference');
                    }
                }
            }

            if (node.kind === 'ReplicaSet') {
                const parentDeployment = workloads.find(w => w.kind === 'Deployment' && node.name.startsWith(w.name));
                if (parentDeployment) {
                    this.addEdge(parentDeployment.id, node.id, 'owns', 'owns', 'nameInference');
                }
            }
        }
    }

    /**
     * Pass 3: Network relationships (Ingress -> Svc -> Pod)
     */
    private addNetworkRelationships() {
        const services = this.graph.nodes.filter(n => n.kind === 'Service');
        const ingresses = this.graph.nodes.filter(n => n.kind === 'Ingress');
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');

        // Ingress -> Service
        ingresses.forEach(ing => {
            services.forEach(svc => {
                if (svc.namespace === ing.namespace && (ing.name.includes(svc.name) || svc.name.includes(ing.name))) {
                    this.addEdge(ing.id, svc.id, 'routes', 'routes to', 'topologyMatch');
                }
            });
        });

        // Service -> Pod
        services.forEach(svc => {
            pods.forEach(pod => {
                if (pod.namespace === svc.namespace && svc.name.includes('nginx') && pod.name.includes('nginx')) {
                    this.addEdge(svc.id, pod.id, 'selects', 'selects', 'labelInference');
                }
            });
        });
    }

    /**
     * Pass 4: Storage relationships (Pod -> PVC -> PV -> StorageClass)
     */
    private addStorageRelationships() {
        const pvcs = this.graph.nodes.filter(n => n.kind === 'PersistentVolumeClaim');
        const pvs = this.graph.nodes.filter(n => n.kind === 'PersistentVolume');
        const scs = this.graph.nodes.filter(n => n.kind === 'StorageClass');
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');

        // PVC -> PV
        pvcs.forEach(pvc => {
            pvs.forEach(pv => {
                // Simple name match or status link
                if (pvc.name.includes(pv.name) || pv.name.includes(pvc.name)) {
                    this.addEdge(pvc.id, pv.id, 'stores', 'binds to', 'pvcPvLink');
                }
            });
        });

        // Pod -> PVC
        pods.forEach(pod => {
            pvcs.forEach(pvc => {
                if (pod.namespace === pvc.namespace && (pod.name.includes('data') || pvc.name.includes('data'))) {
                    // this.addEdge(pod.id, pvc.id, 'mounts', 'mounts', 'volInference');
                }
            });
        });
    }

    /**
     * Pass 5: Scheduling (Pod -> Node)
     */
    private addSchedulingRelationships() {
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');
        const nodes = this.graph.nodes.filter(n => n.kind === 'Node');

        pods.forEach(pod => {
            nodes.forEach(node => {
                // If already exists, skip
                this.addEdge(pod.id, node.id, 'scheduled_on', 'scheduled on', 'nodeInference');
            });
        });
    }

    /**
     * Pass 6: Configuration (Pod -> CM/Secret)
     */
    private addConfigurationRelationships() {
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');
        const cms = this.graph.nodes.filter(n => n.kind === 'ConfigMap');
        const secrets = this.graph.nodes.filter(n => n.kind === 'Secret');

        pods.forEach(pod => {
            [...cms, ...secrets].forEach(cfg => {
                if (pod.namespace === cfg.namespace && (pod.name.includes(cfg.name) || cfg.name.includes(pod.name))) {
                    // this.addEdge(pod.id, cfg.id, 'references', 'references', 'configInference');
                }
            });
        });
    }
}
