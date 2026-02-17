import { ExternalLink, BookOpen, FileCode, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Official Kubernetes documentation links
export const K8S_DOCS: Record<string, { 
  docUrl: string; 
  apiRef: string;
  description: string;
  examples: { name: string; yaml: string }[];
}> = {
  Pod: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/pod-v1/',
    description: 'Pods are the smallest deployable units of computing that you can create and manage in Kubernetes.',
    examples: [
      {
        name: 'Simple Pod',
        yaml: `apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
spec:
  containers:
    - name: nginx
      image: nginx:1.21
      ports:
        - containerPort: 80`
      },
      {
        name: 'Multi-container Pod',
        yaml: `apiVersion: v1
kind: Pod
metadata:
  name: multi-container
spec:
  containers:
    - name: app
      image: app:latest
      ports:
        - containerPort: 8080
    - name: sidecar
      image: sidecar:latest`
      }
    ]
  },
  Deployment: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/deployment-v1/',
    description: 'A Deployment provides declarative updates for Pods and ReplicaSets.',
    examples: [
      {
        name: 'Basic Deployment',
        yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.21
          ports:
            - containerPort: 80`
      },
      {
        name: 'With Resource Limits',
        yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: resource-deployment
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          resources:
            requests:
              memory: "64Mi"
              cpu: "250m"
            limits:
              memory: "128Mi"
              cpu: "500m"`
      }
    ]
  },
  Service: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/service-resources/service-v1/',
    description: 'A Service is an abstract way to expose an application running on a set of Pods as a network service.',
    examples: [
      {
        name: 'ClusterIP Service',
        yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: ClusterIP
  selector:
    app: myapp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080`
      },
      {
        name: 'LoadBalancer Service',
        yaml: `apiVersion: v1
kind: Service
metadata:
  name: my-loadbalancer
spec:
  type: LoadBalancer
  selector:
    app: myapp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080`
      }
    ]
  },
  ConfigMap: {
    docUrl: 'https://kubernetes.io/docs/concepts/configuration/configmap/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/config-map-v1/',
    description: 'A ConfigMap is an API object used to store non-confidential data in key-value pairs.',
    examples: [
      {
        name: 'Basic ConfigMap',
        yaml: `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  database_host: "localhost"
  database_port: "5432"
  log_level: "info"`
      }
    ]
  },
  Secret: {
    docUrl: 'https://kubernetes.io/docs/concepts/configuration/secret/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/secret-v1/',
    description: 'A Secret is an object that contains a small amount of sensitive data such as a password, token, or key.',
    examples: [
      {
        name: 'Opaque Secret',
        yaml: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
type: Opaque
stringData:
  username: admin
  password: supersecret`
      }
    ]
  },
  StatefulSet: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/stateful-set-v1/',
    description: 'StatefulSet is the workload API object used to manage stateful applications with persistent storage.',
    examples: [
      {
        name: 'Basic StatefulSet',
        yaml: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: "nginx"
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.21
          ports:
            - containerPort: 80`
      }
    ]
  },
  DaemonSet: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/daemon-set-v1/',
    description: 'A DaemonSet ensures that all (or some) Nodes run a copy of a Pod.',
    examples: [
      {
        name: 'Node Exporter DaemonSet',
        yaml: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-exporter
spec:
  selector:
    matchLabels:
      app: node-exporter
  template:
    metadata:
      labels:
        app: node-exporter
    spec:
      containers:
        - name: exporter
          image: prom/node-exporter:latest`
      }
    ]
  },
  Job: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/job/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/job-v1/',
    description: 'A Job creates one or more Pods and ensures that a specified number of them successfully terminate.',
    examples: [
      {
        name: 'Basic Job',
        yaml: `apiVersion: batch/v1
kind: Job
metadata:
  name: pi
spec:
  template:
    spec:
      containers:
        - name: pi
          image: perl:5.34
          command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
      restartPolicy: Never
  backoffLimit: 4`
      }
    ]
  },
  CronJob: {
    docUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/',
    description: 'A CronJob creates Jobs on a repeating schedule.',
    examples: [
      {
        name: 'Hourly CronJob',
        yaml: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: hourly-backup
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: backup:latest
          restartPolicy: OnFailure`
      }
    ]
  },
  Ingress: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/ingress/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/service-resources/ingress-v1/',
    description: 'Ingress exposes HTTP and HTTPS routes from outside the cluster to services within the cluster.',
    examples: [
      {
        name: 'Simple Ingress',
        yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: minimal-ingress
spec:
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp
                port:
                  number: 80`
      }
    ]
  },
  PersistentVolumeClaim: {
    docUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/config-and-storage-resources/persistent-volume-claim-v1/',
    description: 'A PersistentVolumeClaim is a request for storage by a user.',
    examples: [
      {
        name: 'Basic PVC',
        yaml: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi`
      }
    ]
  },
  Namespace: {
    docUrl: 'https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/namespace-v1/',
    description: 'Namespaces provide a mechanism for isolating groups of resources within a single cluster.',
    examples: [
      {
        name: 'Create Namespace',
        yaml: `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
  labels:
    team: backend`
      }
    ]
  },
  NetworkPolicy: {
    docUrl: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/policy-resources/network-policy-v1/',
    description: 'NetworkPolicies allow you to specify how a pod is allowed to communicate with various network entities.',
    examples: [
      {
        name: 'Deny All Ingress',
        yaml: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress`
      }
    ]
  },
  HorizontalPodAutoscaler: {
    docUrl: 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/horizontal-pod-autoscaler-v2/',
    description: 'The HorizontalPodAutoscaler automatically scales the number of Pods in a workload resource.',
    examples: [
      {
        name: 'CPU-based HPA',
        yaml: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: cpu-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50`
      }
    ]
  },
  APIService: {
    docUrl: 'https://kubernetes.io/docs/tasks/extend-kubernetes/configure-aggregation-layer/',
    apiRef: 'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/api-service-v1/',
    description: 'APIService defines a way to register extension API servers (e.g. metrics, custom resources) into the cluster API.',
    examples: [
      {
        name: 'APIService pointing to a service',
        yaml: `apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata:
  name: v1beta1.metrics.k8s.io
spec:
  service:
    namespace: kube-system
    name: metrics-server
  group: metrics.k8s.io
  version: v1beta1
  insecureSkipTLSVerify: false`
      }
    ]
  }
};

interface ResourceDocumentationProps {
  resourceKind: string;
  className?: string;
}

export function ResourceDocumentation({ resourceKind, className }: ResourceDocumentationProps) {
  const docs = K8S_DOCS[resourceKind as keyof typeof K8S_DOCS] || K8S_DOCS.Pod;

  const handleCopyExample = (yaml: string) => {
    navigator.clipboard.writeText(yaml);
    toast.success('Example copied to clipboard');
  };

  return (
    <ScrollArea className={cn('h-full', className)}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {resourceKind} Documentation
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {docs.description}
          </p>
        </div>

        {/* Official Links */}
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" asChild className="gap-2">
            <a href={docs.docUrl} target="_blank" rel="noopener noreferrer">
              <BookOpen className="h-4 w-4" />
              Concepts Guide
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild className="gap-2">
            <a href={docs.apiRef} target="_blank" rel="noopener noreferrer">
              <FileCode className="h-4 w-4" />
              API Reference
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>

        {/* Examples */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Examples
          </h3>
          
          {docs.examples.map((example, idx) => (
            <div key={idx} className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{example.name}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyExample(example.yaml)}
                  className="h-7 gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <pre className="p-4 text-xs font-mono overflow-x-auto bg-background">
                <code className="text-foreground">{example.yaml}</code>
              </pre>
            </div>
          ))}
        </div>

        {/* Quick Tips */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h4 className="text-sm font-medium text-primary mb-2">Quick Tips</h4>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li>• Use <code className="text-foreground bg-muted px-1 py-0.5 rounded">metadata.labels</code> for organizing resources</li>
            <li>• Always specify <code className="text-foreground bg-muted px-1 py-0.5 rounded">resources.requests</code> and <code className="text-foreground bg-muted px-1 py-0.5 rounded">limits</code></li>
            <li>• Use namespaces to isolate environments</li>
            <li>• Add descriptive names to all containers</li>
          </ul>
        </div>
      </div>
    </ScrollArea>
  );
}
