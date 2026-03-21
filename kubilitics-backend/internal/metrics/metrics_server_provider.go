// MetricsServerProvider implements MetricsProvider using the Kubernetes metrics-server API.
// This is the primary implementation; Prometheus/OTel providers can be added later.
package metrics

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

func formatCPU(millicores float64) string {
	return fmt.Sprintf("%.2fm", millicores)
}
func formatMemoryMi(mi float64) string {
	return fmt.Sprintf("%.2fMi", mi)
}

// MetricsServerProvider fetches pod/node usage from metrics.k8s.io/v1beta1.
type MetricsServerProvider struct{}

// NewMetricsServerProvider returns the default in-cluster metrics provider.
func NewMetricsServerProvider() *MetricsServerProvider {
	return &MetricsServerProvider{}
}

// GetPodUsage returns current CPU/memory for the given pod.
func (p *MetricsServerProvider) GetPodUsage(ctx context.Context, client *k8s.Client, namespace, podName string) (*models.PodUsage, error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return nil, fmt.Errorf("metrics client: %w", err)
	}
	pm, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("pod metrics: %w", err)
	}
	var totalCPUMilli, totalMemoryMi float64
	containers := make([]models.ContainerUsage, 0, len(pm.Containers))
	for _, c := range pm.Containers {
		cpuMilli := c.Usage.Cpu().AsApproximateFloat64() * 1000
		memMi := float64(c.Usage.Memory().Value()) / (1024 * 1024)
		totalCPUMilli += cpuMilli
		totalMemoryMi += memMi
		containers = append(containers, models.ContainerUsage{
			Name:   c.Name,
			CPU:    formatCPU(cpuMilli),
			Memory: formatMemoryMi(memMi),
		})
	}
	return &models.PodUsage{
		Name:       podName,
		Namespace:  namespace,
		CPU:        formatCPU(totalCPUMilli),
		Memory:     formatMemoryMi(totalMemoryMi),
		Containers: containers,
	}, nil
}

// GetPodNetworkStats returns network I/O bytes for a pod from the kubelet stats/summary API.
// This data comes from the kubelet's built-in cAdvisor — available on every cluster without extra installation.
// Path: /api/v1/nodes/{nodeName}/proxy/stats/summary → pods[].network.interfaces[].{rxBytes,txBytes}
func (p *MetricsServerProvider) GetPodNetworkStats(ctx context.Context, client *k8s.Client, namespace, podName string) (rxBytes, txBytes int64, err error) {
	// Step 1: Find which node the pod runs on
	pod, err := client.Clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return 0, 0, nil // best-effort: return zeros if pod lookup fails
	}
	nodeName := pod.Spec.NodeName
	if nodeName == "" {
		return 0, 0, nil // pod not scheduled yet
	}

	// Step 2: Fetch kubelet stats/summary via the API server proxy
	raw, err := client.Clientset.CoreV1().RESTClient().Get().
		Resource("nodes").Name(nodeName).SubResource("proxy", "stats", "summary").
		DoRaw(ctx)
	if err != nil {
		return 0, 0, nil // best-effort: return zeros if kubelet stats unavailable
	}

	// Step 3: Parse the response and find our pod's network stats
	var summary kubeletStatsSummary
	if err := json.Unmarshal(raw, &summary); err != nil {
		return 0, 0, nil
	}

	for _, ps := range summary.Pods {
		if ps.PodRef.Name == podName && ps.PodRef.Namespace == namespace {
			// Prefer the top-level network rx/tx (default interface, e.g. eth0)
			if ps.Network.RxBytes > 0 || ps.Network.TxBytes > 0 {
				return ps.Network.RxBytes, ps.Network.TxBytes, nil
			}
			// Fall back to summing all interfaces
			for _, iface := range ps.Network.Interfaces {
				rxBytes += iface.RxBytes
				txBytes += iface.TxBytes
			}
			return rxBytes, txBytes, nil
		}
	}

	return 0, 0, nil // pod not found in stats — might not have network yet
}

// kubelet stats/summary API response types (subset of what we need)
type kubeletStatsSummary struct {
	Pods []kubeletPodStats `json:"pods"`
}

type kubeletPodStats struct {
	PodRef  kubeletPodRef     `json:"podRef"`
	Network kubeletNetStats   `json:"network"`
}

type kubeletPodRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type kubeletNetStats struct {
	RxBytes    int64               `json:"rxBytes"`
	TxBytes    int64               `json:"txBytes"`
	Interfaces []kubeletIfaceStats `json:"interfaces"`
}

type kubeletIfaceStats struct {
	Name    string `json:"name"`
	RxBytes int64  `json:"rxBytes"`
	TxBytes int64  `json:"txBytes"`
}

// GetNodeUsage returns current CPU and memory for the given node.
func (p *MetricsServerProvider) GetNodeUsage(ctx context.Context, client *k8s.Client, nodeName string) (cpu, memory string, err error) {
	metricsClient, err := versioned.NewForConfig(client.Config)
	if err != nil {
		return "", "", fmt.Errorf("metrics client: %w", err)
	}
	nm, err := metricsClient.MetricsV1beta1().NodeMetricses().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return "", "", fmt.Errorf("node metrics: %w", err)
	}
	cpuMilli := nm.Usage.Cpu().AsApproximateFloat64() * 1000
	memMi := float64(nm.Usage.Memory().Value()) / (1024 * 1024)
	return formatCPU(cpuMilli), formatMemoryMi(memMi), nil
}
