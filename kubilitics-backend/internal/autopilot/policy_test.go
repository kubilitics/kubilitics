package autopilot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestPolicyEngine_AuditMode(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{RuleID: "test", Mode: "audit", Enabled: true}
	finding := Finding{RuleID: "test", TargetNamespace: "prod"}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicySkip, decision, "audit mode should skip")
}

func TestPolicyEngine_ApprovalMode(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{RuleID: "test", Mode: "approval", Enabled: true}
	finding := Finding{RuleID: "test", TargetNamespace: "prod"}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicyDefer, decision, "approval mode should defer")
}

func TestPolicyEngine_AutoMode(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{RuleID: "test", Mode: "auto", Enabled: true}
	finding := Finding{RuleID: "test", TargetNamespace: "prod"}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicyApprove, decision, "auto mode should approve")
}

func TestPolicyEngine_Disabled(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{RuleID: "test", Mode: "auto", Enabled: false}
	finding := Finding{RuleID: "test", TargetNamespace: "prod"}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicySkip, decision, "disabled rule should skip")
}

func TestPolicyEngine_NamespaceIncludes(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{
		RuleID:            "test",
		Mode:              "auto",
		Enabled:           true,
		NamespaceIncludes: []string{"staging"},
	}

	// prod is not in includes
	finding := Finding{RuleID: "test", TargetNamespace: "prod"}
	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicySkip, decision, "namespace not in includes should skip")

	// staging is in includes
	finding.TargetNamespace = "staging"
	decision = pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicyApprove, decision, "namespace in includes should approve")
}

func TestPolicyEngine_NamespaceExcludes(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{
		RuleID:            "test",
		Mode:              "auto",
		Enabled:           true,
		NamespaceExcludes: []string{"kube-system"},
	}

	// kube-system is excluded
	finding := Finding{RuleID: "test", TargetNamespace: "kube-system"}
	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicySkip, decision, "excluded namespace should skip")

	// prod is not excluded
	finding.TargetNamespace = "prod"
	decision = pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicyApprove, decision, "non-excluded namespace should approve")
}

func TestPolicyEngine_Cooldown(t *testing.T) {
	repo := NewMemRepository()
	pe := NewPolicyEngine(repo)

	// Insert a recent action
	recentAction := &ActionRecord{
		ID:              "action-1",
		ClusterID:       "",
		RuleID:          "test-rule",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gw",
		Status:          "applied",
		CreatedAt:       time.Now().Add(-5 * time.Minute), // 5 minutes ago
	}
	_ = repo.CreateAction(recentAction)

	cfg := RuleConfig{
		RuleID:          "test-rule",
		Mode:            "auto",
		Enabled:         true,
		CooldownMinutes: 30, // 30-minute cooldown
	}

	finding := Finding{
		RuleID:          "test-rule",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gw",
	}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicySkip, decision, "should skip due to cooldown — last action was 5 min ago, cooldown is 30 min")
}

func TestPolicyEngine_CooldownExpired(t *testing.T) {
	repo := NewMemRepository()
	pe := NewPolicyEngine(repo)

	// Insert an old action
	oldAction := &ActionRecord{
		ID:              "action-2",
		ClusterID:       "",
		RuleID:          "test-rule",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gw",
		Status:          "applied",
		CreatedAt:       time.Now().Add(-60 * time.Minute), // 60 minutes ago
	}
	_ = repo.CreateAction(oldAction)

	cfg := RuleConfig{
		RuleID:          "test-rule",
		Mode:            "auto",
		Enabled:         true,
		CooldownMinutes: 30, // 30-minute cooldown
	}

	finding := Finding{
		RuleID:          "test-rule",
		TargetKind:      "Deployment",
		TargetNamespace: "prod",
		TargetName:      "api-gw",
	}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicyApprove, decision, "cooldown expired (60 min ago > 30 min cooldown), should approve")
}

func TestPolicyEngine_UnknownMode(t *testing.T) {
	pe := NewPolicyEngine(nil)
	cfg := RuleConfig{RuleID: "test", Mode: "unknown", Enabled: true}
	finding := Finding{RuleID: "test", TargetNamespace: "prod"}

	decision := pe.Evaluate(finding, cfg)
	assert.Equal(t, PolicyDefer, decision, "unknown mode should defer for safety")
}
