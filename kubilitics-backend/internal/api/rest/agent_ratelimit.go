package rest

import (
	"net/http"
	"sync"

	"golang.org/x/time/rate"

	"github.com/kubilitics/kubilitics-backend/internal/auth/agenttoken"
)

// NewClusterRateLimitMiddleware returns a middleware that rate-limits requests
// per cluster ID extracted from the Bearer access JWT.
//
// Scope: only the heartbeat endpoint is wrapped today. The refresh endpoint
// is rare (~hourly) and does not carry a Bearer access token — protecting it
// is deferred to a future spec along with broader anti-abuse measures.
//
// The bucket map is unbounded in v1 (one entry per active cluster). For a hub
// managing 10k+ clusters this is acceptable; LRU eviction is a future concern.
func NewClusterRateLimitMiddleware(signer *agenttoken.Signer, perSecond, burst int) func(http.Handler) http.Handler {
	lim := rate.Limit(perSecond)
	var mu sync.Mutex
	buckets := make(map[string]*rate.Limiter)

	getLimiter := func(clusterID string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()
		if l, ok := buckets[clusterID]; ok {
			return l
		}
		l := rate.NewLimiter(lim, burst)
		buckets[clusterID] = l
		return l
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := bearerToken(r)
			if tok == "" {
				// No token — let the inner handler produce its own 401.
				next.ServeHTTP(w, r)
				return
			}
			claims, err := signer.VerifyAccess(tok)
			if err != nil {
				// Invalid token — let the inner handler reject it properly.
				next.ServeHTTP(w, r)
				return
			}
			if !getLimiter(claims.ClusterID).Allow() {
				writeAgentErr(w, http.StatusTooManyRequests, "rate_limited", "too many requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
