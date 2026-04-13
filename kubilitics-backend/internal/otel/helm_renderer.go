package otel

import (
	"bytes"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// HelmRenderer wraps `helm template` execution to render the kubilitics-otel
// chart with user-supplied values. It does NOT install anything — it just
// produces a YAML stream the user (or our HTTP handler) can hand to kubectl.
//
// This is the only place in the backend that calls the helm CLI. If helm is
// not available on PATH, Render returns an error explaining how to install it.
type HelmRenderer struct {
	chartPath string
}

// NewHelmRenderer builds a renderer pointed at the given chart directory.
// chartPath should be the absolute or relative path to charts/kubilitics-otel/.
func NewHelmRenderer(chartPath string) *HelmRenderer {
	return &HelmRenderer{chartPath: chartPath}
}

// RenderOptions are the user-supplied values templated into the chart.
type RenderOptions struct {
	ClusterID  string
	BackendURL string
	Namespace  string // defaults to "kubilitics-system" if empty
	// ImageRepository and ImageTag are optional overrides for air-gap users.
	ImageRepository string
	ImageTag        string
}

// Render returns the multi-document YAML produced by `helm template ...`.
// Returns a non-nil error if helm is missing, the chart fails to render, or
// required values are missing (the chart's own validation will catch that).
func (r *HelmRenderer) Render(opts RenderOptions) (string, error) {
	if _, err := exec.LookPath("helm"); err != nil {
		return "", fmt.Errorf("helm CLI not found on PATH — install Helm v3.10+ to render the kubilitics-otel chart: %w", err)
	}

	ns := opts.Namespace
	if ns == "" {
		ns = "kubilitics-system"
	}

	chartAbs, err := filepath.Abs(r.chartPath)
	if err != nil {
		return "", fmt.Errorf("resolve chart path: %w", err)
	}

	args := []string{
		"template",
		"kubilitics-otel", // release name
		chartAbs,
		"--namespace", ns,
		"--set", "kubilitics.clusterId=" + opts.ClusterID,
		"--set", "kubilitics.backendUrl=" + opts.BackendURL,
	}
	if opts.ImageRepository != "" {
		args = append(args, "--set", "image.repository="+opts.ImageRepository)
	}
	if opts.ImageTag != "" {
		args = append(args, "--set", "image.tag="+opts.ImageTag)
	}

	var stdout, stderr bytes.Buffer
	cmd := exec.Command("helm", args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		stderrStr := strings.TrimSpace(stderr.String())
		return "", fmt.Errorf("helm template failed: %s", stderrStr)
	}
	return stdout.String(), nil
}
