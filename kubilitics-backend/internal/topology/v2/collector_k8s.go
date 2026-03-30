package v2

import (
	"context"
	"log/slog"
	"sync"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"golang.org/x/sync/errgroup"
)

// CollectFromClient fills a ResourceBundle by listing resources from the given k8s client.
// Namespace filters namespaced resources; empty means all namespaces.
func CollectFromClient(ctx context.Context, client *k8s.Client, namespace string) (*ResourceBundle, error) {
	if client == nil || client.Clientset == nil {
		return nil, nil
	}
	cs := client.Clientset
	opts := metav1.ListOptions{Limit: 500}
	nsOpts := namespace
	if namespace == "" {
		nsOpts = metav1.NamespaceAll
	}
	bundle := &ResourceBundle{}
	var failMu sync.Mutex
	recordFailure := func(resourceType string, err error) {
		slog.Warn("topology v2 collect "+resourceType, "error", err)
		failMu.Lock()
		bundle.FailedResources = append(bundle.FailedResources, resourceType)
		failMu.Unlock()
	}
	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		var continueToken string
		for {
			listOpts := metav1.ListOptions{Limit: 500, Continue: continueToken}
			list, err := cs.CoreV1().Pods(nsOpts).List(gctx, listOpts)
			if err != nil {
				recordFailure("pods", err)
				return nil
			}
			bundle.Pods = append(bundle.Pods, list.Items...)
			continueToken = list.Continue
			if continueToken == "" {
				break
			}
		}
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().Deployments(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("deployments", err)
			return nil
		}
		bundle.Deployments = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().ReplicaSets(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("replicasets", err)
			return nil
		}
		bundle.ReplicaSets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().StatefulSets(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("statefulsets", err)
			return nil
		}
		bundle.StatefulSets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().DaemonSets(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("daemonsets", err)
			return nil
		}
		bundle.DaemonSets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.BatchV1().Jobs(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("jobs", err)
			return nil
		}
		bundle.Jobs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.BatchV1().CronJobs(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("cronjobs", err)
			return nil
		}
		bundle.CronJobs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Services(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("services", err)
			return nil
		}
		bundle.Services = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Endpoints(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("endpoints", err)
			return nil
		}
		bundle.Endpoints = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.DiscoveryV1().EndpointSlices(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("endpointslices", err)
			return nil
		}
		bundle.EndpointSlices = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NetworkingV1().Ingresses(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("ingresses", err)
			return nil
		}
		bundle.Ingresses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NetworkingV1().IngressClasses().List(gctx, opts)
		if err != nil {
			recordFailure("ingressclasses", err)
			return nil
		}
		bundle.IngressClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().ConfigMaps(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("configmaps", err)
			return nil
		}
		bundle.ConfigMaps = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Secrets(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("secrets", err)
			return nil
		}
		bundle.Secrets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().PersistentVolumeClaims(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("pvcs", err)
			return nil
		}
		bundle.PVCs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().PersistentVolumes().List(gctx, opts)
		if err != nil {
			recordFailure("pvs", err)
			return nil
		}
		bundle.PVs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.StorageV1().StorageClasses().List(gctx, opts)
		if err != nil {
			recordFailure("storageclasses", err)
			return nil
		}
		bundle.StorageClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Nodes().List(gctx, opts)
		if err != nil {
			recordFailure("nodes", err)
			return nil
		}
		bundle.Nodes = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Namespaces().List(gctx, opts)
		if err != nil {
			recordFailure("namespaces", err)
			return nil
		}
		bundle.Namespaces = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().ServiceAccounts(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("serviceaccounts", err)
			return nil
		}
		bundle.ServiceAccounts = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().Roles(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("roles", err)
			return nil
		}
		bundle.Roles = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().RoleBindings(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("rolebindings", err)
			return nil
		}
		bundle.RoleBindings = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().ClusterRoles().List(gctx, opts)
		if err != nil {
			recordFailure("clusterroles", err)
			return nil
		}
		bundle.ClusterRoles = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().ClusterRoleBindings().List(gctx, opts)
		if err != nil {
			recordFailure("clusterrolebindings", err)
			return nil
		}
		bundle.ClusterRoleBindings = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AutoscalingV2().HorizontalPodAutoscalers(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("hpas", err)
			return nil
		}
		bundle.HPAs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.PolicyV1().PodDisruptionBudgets(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("pdbs", err)
			return nil
		}
		bundle.PDBs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NetworkingV1().NetworkPolicies(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("networkpolicies", err)
			return nil
		}
		bundle.NetworkPolicies = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.SchedulingV1().PriorityClasses().List(gctx, opts)
		if err != nil {
			recordFailure("priorityclasses", err)
			return nil
		}
		bundle.PriorityClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NodeV1().RuntimeClasses().List(gctx, opts)
		if err != nil {
			recordFailure("runtimeclasses", err)
			return nil
		}
		bundle.RuntimeClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AdmissionregistrationV1().MutatingWebhookConfigurations().List(gctx, opts)
		if err != nil {
			recordFailure("mutatingwebhooks", err)
			return nil
		}
		bundle.MutatingWebhooks = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(gctx, opts)
		if err != nil {
			recordFailure("validatingwebhooks", err)
			return nil
		}
		bundle.ValidatingWebhooks = list.Items
		return nil
	})

	g.Go(func() error {
		var continueToken string
		for {
			listOpts := metav1.ListOptions{Limit: 500, Continue: continueToken}
			list, err := cs.CoreV1().Events(nsOpts).List(gctx, listOpts)
			if err != nil {
				recordFailure("events", err)
				return nil
			}
			bundle.Events = append(bundle.Events, list.Items...)
			continueToken = list.Continue
			if continueToken == "" {
				break
			}
		}
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().ResourceQuotas(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("resourcequotas", err)
			return nil
		}
		bundle.ResourceQuotas = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().LimitRanges(nsOpts).List(gctx, opts)
		if err != nil {
			recordFailure("limitranges", err)
			return nil
		}
		bundle.LimitRanges = list.Items
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}
	return bundle, nil
}
