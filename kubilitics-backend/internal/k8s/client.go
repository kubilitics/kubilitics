package k8s

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/time/rate"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// GetKubeconfigContexts returns all context names and the current context from a kubeconfig file.
func GetKubeconfigContexts(kubeconfigPath string) ([]string, string, error) {
	if kubeconfigPath == "" {
		homeDir, _ := os.UserHomeDir()
		if homeDir != "" {
			kubeconfigPath = filepath.Join(homeDir, ".kube", "config")
		}
	}
	if kubeconfigPath == "" {
		return nil, "", nil
	}
	raw, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		&clientcmd.ConfigOverrides{},
	).RawConfig()
	if err != nil {
		return nil, "", err
	}
	names := make([]string, 0, len(raw.Contexts))
	for name := range raw.Contexts {
		names = append(names, name)
	}
	return names, raw.CurrentContext, nil
}

// Client wraps Kubernetes client-go
type Client struct {
	Clientset      kubernetes.Interface
	Dynamic        dynamic.Interface
	Config         *rest.Config
	Context        string
	kubeconfigPath string
	// Timeout for outbound K8s API calls; 0 means no timeout (use request context only).
	Timeout time.Duration
	// Limiter optionally rate-limits outbound API calls per cluster (C1.5). Nil = no limit.
	limiter *rate.Limiter
}

// NewClient creates a new Kubernetes client
func NewClient(kubeconfigPath, context string) (*Client, error) {
	var config *rest.Config
	var err error

	if kubeconfigPath == "" {
		// Try in-cluster config first
		config, err = rest.InClusterConfig()
		if err != nil {
			// Fall back to default kubeconfig
			homeDir, _ := os.UserHomeDir()
			if homeDir != "" {
				kubeconfigPath = filepath.Join(homeDir, ".kube", "config")
			}
		}
	}

	if config == nil {
		config, err = buildConfigFromFlags(context, kubeconfigPath)
		if err != nil {
			return nil, fmt.Errorf("failed to build config: %w", err)
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create clientset: %w", err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	return &Client{
		Clientset:      clientset,
		Dynamic:        dynamicClient,
		Config:         config,
		Context:        context,
		kubeconfigPath: kubeconfigPath,
	}, nil
}

// SetTimeout sets the timeout for outbound K8s API calls. Call after NewClient when config is available.
func (c *Client) SetTimeout(d time.Duration) {
	c.Timeout = d
}

// SetLimiter sets a token-bucket rate limiter for outbound K8s API calls (C1.5). Call after NewClient when config is available.
func (c *Client) SetLimiter(l *rate.Limiter) {
	c.limiter = l
}

func (c *Client) waitRateLimit(ctx context.Context) error {
	if c.limiter == nil {
		return nil
	}
	return c.limiter.Wait(ctx)
}

// withTimeout returns ctx with timeout applied if c.Timeout > 0; otherwise returns ctx and a no-op cancel.
func (c *Client) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if c.Timeout > 0 {
		return context.WithTimeout(ctx, c.Timeout)
	}
	return ctx, func() {}
}

func buildConfigFromFlags(context, kubeconfigPath string) (*rest.Config, error) {
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		&clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath},
		&clientcmd.ConfigOverrides{
			CurrentContext: context,
		}).ClientConfig()
}

// GetServerVersion returns Kubernetes server version
func (c *Client) GetServerVersion(ctx context.Context) (string, error) {
	version, err := c.Clientset.Discovery().ServerVersion()
	if err != nil {
		return "", err
	}
	return version.GitVersion, nil
}

// TestConnection verifies connectivity to the cluster (with timeout and retry).
func (c *Client) TestConnection(ctx context.Context) error {
	if err := c.waitRateLimit(ctx); err != nil {
		return err
	}
	ctx, cancel := c.withTimeout(ctx)
	defer cancel()
	return doWithRetry(ctx, defaultRetryAttempts, func() error {
		_, err := c.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{Limit: 1})
		return err
	})
}

// GetClusterInfo returns basic cluster information (with timeout and retry).
func (c *Client) GetClusterInfo(ctx context.Context) (map[string]interface{}, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return nil, err
	}
	ctx, cancel := c.withTimeout(ctx)
	defer cancel()
	return doWithRetryValue(ctx, defaultRetryAttempts, func() (map[string]interface{}, error) {
		version, err := c.GetServerVersion(ctx)
		if err != nil {
			return nil, err
		}
		nodes, err := c.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, err
		}
		namespaces, err := c.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"version":         version,
			"node_count":      len(nodes.Items),
			"namespace_count": len(namespaces.Items),
			"server_url":      c.Config.Host,
		}, nil
	})
}

// NewClientForTest creates a Client that uses the given Clientset. Used by tests (e.g. topology)
// that only need Clientset. Config and Dynamic are nil; callers must not use client methods that need them.
func NewClientForTest(clientset kubernetes.Interface) *Client {
	return &Client{Clientset: clientset}
}
