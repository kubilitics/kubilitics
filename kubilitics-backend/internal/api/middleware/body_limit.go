// Package middleware provides request body size limiting for enterprise safety (BE-DATA-001).
package middleware

import (
	"net/http"
	"strings"
)

const (
	// DefaultStandardMaxBodyBytes is the default max request body for non-apply API requests (512KB).
	DefaultStandardMaxBodyBytes = 512 * 1024
	// DefaultApplyMaxBodyBytes is the default max request body for POST .../apply (5MB).
	DefaultApplyMaxBodyBytes = 5 * 1024 * 1024
)

// MaxBodySize returns middleware that limits request body size: applyMax for POST .../apply, standardMax otherwise.
// Use for methods that may have a body (POST, PUT, PATCH). GET/HEAD/DELETE are not limited.
func MaxBodySize(standardMax, applyMax int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body == nil {
				next.ServeHTTP(w, r)
				return
			}
			max := standardMax
			if (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch) &&
				strings.HasSuffix(strings.TrimSuffix(r.URL.Path, "/"), "/apply") {
				max = applyMax
			}
			r.Body = http.MaxBytesReader(w, r.Body, max)
			next.ServeHTTP(w, r)
		})
	}
}
