// Package validate provides input validation for API path and body parameters (D1.1, D1.2).
package validate

import (
	"regexp"
	"strings"
)

// ClusterIDMaxLen is the maximum allowed length for clusterId (stored in DB, used in paths).
const ClusterIDMaxLen = 128

// K8s name regex: DNS subdomain (RFC 1123) — lowercase alphanumeric, '-' or '.', max 253 for namespace/name.
// We use a conservative subset: alphanumeric and hyphen, 1–253 chars.
var k8sNameRe = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)

// ClusterID validates clusterId from path: alphanumeric, hyphen, underscore; 1–ClusterIDMaxLen.
func ClusterID(id string) bool {
	if id == "" || len(id) > ClusterIDMaxLen {
		return false
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

// Kind validates Kubernetes resource kind: alphanumeric, no path chars; 1–64 chars.
func Kind(kind string) bool {
	if kind == "" || len(kind) > 64 {
		return false
	}
	for _, r := range kind {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		return false
	}
	return true
}

// Namespace validates namespace: empty (cluster-scoped) or valid DNS subdomain.
func Namespace(ns string) bool {
	if ns == "" {
		return true
	}
	if len(ns) > 253 {
		return false
	}
	return k8sNameRe.MatchString(strings.ToLower(ns))
}

// Name validates resource name: valid DNS subdomain.
func Name(name string) bool {
	if name == "" || len(name) > 253 {
		return false
	}
	return k8sNameRe.MatchString(strings.ToLower(name))
}
