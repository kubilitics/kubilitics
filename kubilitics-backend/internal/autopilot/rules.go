package autopilot

import (
	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// Rule is the interface every autopilot detection rule must implement.
type Rule interface {
	ID() string
	Name() string
	Description() string
	Severity() string
	Detect(snapshot *graph.GraphSnapshot) []Finding
}

// RuleRegistry holds all registered rules and dispatches detection.
type RuleRegistry struct {
	rules []Rule
}

// NewRuleRegistry creates a registry pre-loaded with all built-in rules.
func NewRuleRegistry() *RuleRegistry {
	return &RuleRegistry{
		rules: []Rule{
			&SPOFRule{},
			&MissingPDBRule{},
			&MissingLimitsRule{},
			&MissingNetPolRule{},
			&MissingAntiAffinityRule{},
			&MissingRequestsRule{},
		},
	}
}

// Rules returns the list of registered rules.
func (r *RuleRegistry) Rules() []Rule {
	return r.rules
}

// DetectAll runs every enabled rule against the snapshot and aggregates findings.
func (r *RuleRegistry) DetectAll(snapshot *graph.GraphSnapshot) []Finding {
	var all []Finding
	for _, rule := range r.rules {
		findings := rule.Detect(snapshot)
		all = append(all, findings...)
	}
	return all
}
