package relationships

import (
	"context"
	"log/slog"
	"sync"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	"golang.org/x/sync/errgroup"
)

// Registry holds all registered relationship matchers for v2.
type Registry struct {
	matchers []Matcher
}

// NewRegistry creates an empty registry.
func NewRegistry() *Registry {
	return &Registry{
		matchers: []Matcher{},
	}
}

// Register adds a matcher to the registry.
func (r *Registry) Register(m Matcher) {
	if m == nil {
		return
	}
	r.matchers = append(r.matchers, m)
}

// Matchers returns all registered matchers.
func (r *Registry) Matchers() []Matcher {
	return r.matchers
}

// NewDefaultRegistry returns a registry with all v2 relationship matchers registered.
func NewDefaultRegistry() *Registry {
	r := NewRegistry()
	r.Register(&OwnerRefMatcher{})
	r.Register(&SelectorMatcher{})
	r.Register(&VolumeMountMatcher{})
	r.Register(&EnvRefMatcher{})
	r.Register(&IngressMatcher{})
	r.Register(&EndpointMatcher{})
	r.Register(&RBACMatcher{})
	r.Register(&SchedulingMatcher{})
	r.Register(&ScalingMatcher{})
	r.Register(&StorageMatcher{})
	r.Register(&WebhookMatcher{})
	r.Register(&NamespaceMatcher{})
	r.Register(&AffinityMatcher{})
	r.Register(&WorkloadRBACMatcher{})
	r.Register(&ProjectedVolumeMatcher{})
	r.Register(&NetworkPolicyRuleMatcher{})
	r.Register(&StatefulSetServiceMatcher{})
	r.Register(&StatefulSetPVCMatcher{})
	r.Register(&ServiceAccountSecretMatcher{})
	r.Register(&EventMatcher{})
	r.Register(&ResourceQuotaMatcher{})
	r.Register(&ImagePullSecretMatcher{})
	r.Register(&TaintTolerationMatcher{})
	r.Register(&WebhookTargetMatcher{})
	r.Register(&CrossNamespaceDNSMatcher{})
	return r
}

// MatchAll runs all registered matchers concurrently and aggregates edges.
// Errors from individual matchers are logged and not fatal; partial results are returned.
// It returns deduplicated edges, a list of matcher names that encountered errors, and any fatal error.
func (r *Registry) MatchAll(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, []string, error) {
	if bundle == nil {
		return nil, nil, nil
	}
	var mu sync.Mutex
	var allEdges []v2.TopologyEdge
	var failedMatchers []string
	g, gctx := errgroup.WithContext(ctx)
	for _, m := range r.matchers {
		m := m
		g.Go(func() error {
			edges, err := m.Match(gctx, bundle)
			if err != nil {
				slog.Warn("topology v2 matcher error", "matcher", m.Name(), "error", err)
				mu.Lock()
				failedMatchers = append(failedMatchers, m.Name())
				mu.Unlock()
				return nil // non-fatal
			}
			if len(edges) > 0 {
				mu.Lock()
				allEdges = append(allEdges, edges...)
				mu.Unlock()
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return allEdges, failedMatchers, err
	}

	// Global edge deduplication by (source + target + relationshipType)
	seen := make(map[string]bool, len(allEdges))
	deduped := make([]v2.TopologyEdge, 0, len(allEdges))
	for _, e := range allEdges {
		key := e.Source + "|" + e.Target + "|" + string(e.RelationshipType)
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, e)
	}
	return deduped, failedMatchers, nil
}

