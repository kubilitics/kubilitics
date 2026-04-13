package rest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// TracingComponentV2 is one row in the live status dashboard.
// NOTE: V2 suffix is temporary during the refactor — Task 14 renames to TracingComponent
// after the old type in tracing.go is deleted.
type TracingComponentV2 struct {
	Key              string  `json:"key"`            // "cert-manager" | "otel-operator" | "kubilitics-collector" | "trace-ingestion"
	Name             string  `json:"name"`           // human-readable label
	Status           string  `json:"status"`         // "missing" | "installing" | "ready" | "no-data"
	Namespace        string  `json:"namespace,omitempty"`
	VersionInstalled *string `json:"version_installed"`
	VersionRequired  string  `json:"version_required,omitempty"`
	SkipIfPresent    bool    `json:"skip_if_present"`
	// Trace-ingestion-only fields:
	SpansPerMinute *int   `json:"spans_per_minute,omitempty"`
	LastSpanSeenAt *int64 `json:"last_span_seen_at,omitempty"` // unix ms
	// Collector-only fields:
	PodStatus        string `json:"pod_status,omitempty"`
	ServiceEndpoints int    `json:"service_endpoints,omitempty"`
}

// TracingInstallCommands holds the pre-filled install commands for each
// distribution channel.
type TracingInstallCommands struct {
	Helm         string `json:"helm"`
	Kubectl      string `json:"kubectl"`
	KustomizeURL string `json:"kustomize_url"`
}

// TracingStatusResponseV2 is what GET /clusters/{id}/tracing/status will return
// once the rewrite completes. NOTE: V2 suffix is temporary — Task 14 renames.
type TracingStatusResponseV2 struct {
	ClusterID   string                 `json:"cluster_id"`
	ClusterName string                 `json:"cluster_name"`
	BackendURL  string                 `json:"backend_url"`
	AllReady    bool                   `json:"all_ready"`
	Components  []TracingComponentV2   `json:"components"`
	Install     TracingInstallCommands `json:"install"`
}

// computeTracingStatus is the read-only logic that inspects a cluster and
// returns the live status of all observability components. Pure function —
// takes a clientset, returns a response. Tested with the fake clientset.
func (h *TracingHandler) computeTracingStatus(
	ctx context.Context,
	cs kubernetes.Interface,
	clusterID string,
	clusterName string,
	backendURL string,
) TracingStatusResponseV2 {
	resp := TracingStatusResponseV2{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		BackendURL:  backendURL,
		Components:  make([]TracingComponentV2, 0, 4),
	}

	// Component 1: cert-manager
	cmStatus := "missing"
	if _, err := cs.CoreV1().Namespaces().Get(ctx, "cert-manager", metav1.GetOptions{}); err == nil {
		// Namespace exists; check the webhook deployment for ready state.
		dep, derr := cs.AppsV1().Deployments("cert-manager").Get(ctx, "cert-manager-webhook", metav1.GetOptions{})
		if derr == nil && dep.Status.ReadyReplicas > 0 {
			cmStatus = "ready"
		} else {
			cmStatus = "installing"
		}
	}
	resp.Components = append(resp.Components, TracingComponentV2{
		Key:             "cert-manager",
		Name:            "cert-manager",
		Status:          cmStatus,
		Namespace:       "cert-manager",
		VersionRequired: ">=1.11",
		SkipIfPresent:   true,
	})

	// Component 2: OpenTelemetry Operator
	opStatus := "missing"
	if _, err := cs.CoreV1().Namespaces().Get(ctx, "opentelemetry-operator-system", metav1.GetOptions{}); err == nil {
		dep, derr := cs.AppsV1().Deployments("opentelemetry-operator-system").Get(ctx, "opentelemetry-operator-controller-manager", metav1.GetOptions{})
		if derr == nil && dep.Status.ReadyReplicas > 0 {
			opStatus = "ready"
		} else {
			opStatus = "installing"
		}
	}
	resp.Components = append(resp.Components, TracingComponentV2{
		Key:             "otel-operator",
		Name:            "OpenTelemetry Operator",
		Status:          opStatus,
		Namespace:       "opentelemetry-operator-system",
		VersionRequired: ">=0.85",
		SkipIfPresent:   true,
	})

	// Component 3: Kubilitics collector
	collectorStatus := "missing"
	collectorPodStatus := ""
	collectorEndpoints := 0
	if _, err := cs.CoreV1().Namespaces().Get(ctx, "kubilitics-system", metav1.GetOptions{}); err == nil {
		dep, derr := cs.AppsV1().Deployments("kubilitics-system").Get(ctx, "otel-collector", metav1.GetOptions{})
		if derr == nil {
			if dep.Status.ReadyReplicas == dep.Status.Replicas && dep.Status.Replicas > 0 {
				collectorStatus = "ready"
			} else {
				collectorStatus = "installing"
			}
			collectorPodStatus = fmt.Sprintf("%d/%d ready", dep.Status.ReadyReplicas, dep.Status.Replicas)
		}
		// Service endpoints — informational only.
		if ep, eerr := cs.CoreV1().Endpoints("kubilitics-system").Get(ctx, "otel-collector", metav1.GetOptions{}); eerr == nil {
			for _, subset := range ep.Subsets {
				collectorEndpoints += len(subset.Addresses)
			}
		}
	}
	resp.Components = append(resp.Components, TracingComponentV2{
		Key:              "kubilitics-collector",
		Name:             "Kubilitics OTel Collector",
		Status:           collectorStatus,
		Namespace:        "kubilitics-system",
		PodStatus:        collectorPodStatus,
		ServiceEndpoints: collectorEndpoints,
		SkipIfPresent:    false,
	})

	// Component 4: Trace ingestion (data-plane health)
	// "ready" only if collector is ready AND we've seen a span recently.
	// Real span tracking is wired up in a follow-up. For now: "no-data" if
	// collector is ready, "missing" otherwise.
	ingestionStatus := "missing"
	if collectorStatus == "ready" {
		ingestionStatus = "no-data"
		// TODO(future): plumb real last-span timestamp from the receiver and flip to "ready".
	}
	resp.Components = append(resp.Components, TracingComponentV2{
		Key:    "trace-ingestion",
		Name:   "Trace ingestion",
		Status: ingestionStatus,
	})

	// Compute all_ready. "no-data" is acceptable — it means the install
	// worked but no apps are instrumented yet, which the UI renders as success.
	resp.AllReady = true
	for _, c := range resp.Components {
		if c.Status != "ready" && c.Status != "no-data" {
			resp.AllReady = false
			break
		}
	}

	// Render install commands with cluster-specific values.
	resp.Install = TracingInstallCommands{
		Helm: fmt.Sprintf(
			"helm repo add kubilitics https://charts.kubilitics.io && helm install kubilitics-otel kubilitics/kubilitics-otel --namespace kubilitics-system --create-namespace --set kubilitics.clusterId=%s --set kubilitics.backendUrl=%s",
			clusterID, backendURL,
		),
		Kubectl: fmt.Sprintf(
			"kubectl apply -f http://localhost:8190/api/v1/clusters/%s/install/kubilitics-otel.yaml",
			clusterID,
		),
		KustomizeURL: "https://github.com/kubilitics/kubilitics/tree/main/install/kustomize",
	}

	return resp
}

// GetTracingStatusV2 is the new HTTP handler. It coexists with the old
// GetTracingStatus in tracing.go until Task 14 deletes the old one and
// renames this to GetTracingStatus.
func (h *TracingHandler) GetTracingStatusV2(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	client, err := h.clusterService.GetClient(clusterID)
	if err != nil {
		http.Error(w, "cluster not found: "+err.Error(), http.StatusNotFound)
		return
	}

	// Backend URL is hardcoded for now; future work derives it from cluster
	// connectivity (ingress / nodeport / port-forward).
	backendURL := "http://host.docker.internal:8190"

	resp := h.computeTracingStatus(r.Context(), client.Clientset, clusterID, clusterID, backendURL)

	// Headers BEFORE body.
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
