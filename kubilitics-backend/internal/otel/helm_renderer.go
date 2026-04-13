package otel

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// ErrInvalidRenderOptions wraps validation failures so HTTP handlers can
// return 400 Bad Request instead of 500 Internal Server Error.
// Check with errors.Is(err, ErrInvalidRenderOptions).
var ErrInvalidRenderOptions = errors.New("invalid render options")

// clusterIDPattern allows UUIDs, alphanumerics, dashes, and underscores —
// deliberately rejects commas, equals, and shell/helm metacharacters so a
// hostile cluster ID cannot inject additional --set values into helm.
var clusterIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// validateRenderOptions rejects inputs that could inject extra helm --set
// values via comma/equals, or could escape shell quoting. Backend URL is
// parsed as a real URL.
func validateRenderOptions(opts RenderOptions) error {
	if opts.ClusterID == "" {
		return fmt.Errorf("%w: clusterId is REQUIRED", ErrInvalidRenderOptions)
	}
	if !clusterIDPattern.MatchString(opts.ClusterID) {
		return fmt.Errorf("%w: clusterId %q contains invalid characters — must match [a-zA-Z0-9_-]{1,128}", ErrInvalidRenderOptions, opts.ClusterID)
	}
	if opts.BackendURL == "" {
		return fmt.Errorf("%w: backendUrl is REQUIRED", ErrInvalidRenderOptions)
	}
	u, err := url.Parse(opts.BackendURL)
	if err != nil {
		return fmt.Errorf("%w: backendUrl is not a valid URL: %v", ErrInvalidRenderOptions, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%w: backendUrl must use http or https scheme, got %q", ErrInvalidRenderOptions, u.Scheme)
	}
	// Reject embedded commas — helm --set splits on them.
	if strings.ContainsAny(opts.BackendURL, ",\n\r") {
		return fmt.Errorf("%w: backendUrl contains invalid characters (comma or newline)", ErrInvalidRenderOptions)
	}
	return nil
}

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
	if err := validateRenderOptions(opts); err != nil {
		return "", err
	}
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
