package autopilot

import (
	"log/slog"
	"time"
)

// PolicyDecision indicates the outcome of evaluating a finding against its rule config.
type PolicyDecision string

const (
	// PolicyApprove means the action should be executed automatically.
	PolicyApprove PolicyDecision = "approve"
	// PolicyDefer means the action needs human approval.
	PolicyDefer PolicyDecision = "defer"
	// PolicySkip means the action is audit-only or out of scope.
	PolicySkip PolicyDecision = "skip"
)

// PolicyEngine evaluates findings against per-rule configuration to determine
// whether an action should be auto-applied, deferred for approval, or skipped.
type PolicyEngine struct {
	repo AutoPilotRepository
}

// NewPolicyEngine creates a new PolicyEngine backed by the given repository.
func NewPolicyEngine(repo AutoPilotRepository) *PolicyEngine {
	return &PolicyEngine{repo: repo}
}

// Evaluate determines the policy decision for a finding given its rule config.
func (p *PolicyEngine) Evaluate(finding Finding, config RuleConfig) PolicyDecision {
	// Rule disabled
	if !config.Enabled {
		return PolicySkip
	}

	// Namespace scope check
	if !p.namespaceAllowed(finding.TargetNamespace, config) {
		return PolicySkip
	}

	// Mode check
	switch config.Mode {
	case "audit":
		return PolicySkip
	case "approval":
		return PolicyDefer
	case "auto":
		// Check cooldown
		if p.isInCooldown(finding, config) {
			return PolicySkip
		}
		return PolicyApprove
	default:
		// Unknown mode; default to defer for safety
		return PolicyDefer
	}
}

// namespaceAllowed checks if the target namespace is within the configured scope.
func (p *PolicyEngine) namespaceAllowed(namespace string, config RuleConfig) bool {
	// If includes are specified, namespace must be in the list
	if len(config.NamespaceIncludes) > 0 {
		found := false
		for _, ns := range config.NamespaceIncludes {
			if ns == namespace {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// If excludes are specified, namespace must NOT be in the list
	for _, ns := range config.NamespaceExcludes {
		if ns == namespace {
			return false
		}
	}

	return true
}

// isInCooldown checks if a recent action was taken for this rule + target within the cooldown window.
func (p *PolicyEngine) isInCooldown(finding Finding, config RuleConfig) bool {
	if config.CooldownMinutes <= 0 {
		return false
	}

	if p.repo == nil {
		return false
	}

	lastAction, err := p.repo.GetLastActionTime(
		"", // clusterID is not on the finding; caller ensures correct cluster scoping
		config.RuleID,
		finding.TargetKind,
		finding.TargetNamespace,
		finding.TargetName,
	)
	if err != nil {
		slog.Warn("failed to check cooldown", "rule", config.RuleID, "error", err)
		return false
	}

	if lastAction == nil {
		return false
	}

	cooldownEnd := lastAction.Add(time.Duration(config.CooldownMinutes) * time.Minute)
	return time.Now().Before(cooldownEnd)
}
