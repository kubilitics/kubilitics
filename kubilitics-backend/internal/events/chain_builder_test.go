package events

import (
	"testing"
	"time"
)

// TestCausalChain_Basics verifies that CausalNode, CausalLinkV2, and CausalChain
// can be constructed and that field access works as expected.
func TestCausalChain_Basics(t *testing.T) {
	now := time.Now().UTC()

	// --- CausalNode ---
	rootNode := CausalNode{
		ResourceKey:  "default/Pod/crashy-pod",
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "crashy-pod",
		EventReason:  "BackOff",
		EventMessage: "Back-off restarting failed container",
		Timestamp:    now,
		HealthStatus: "critical",
	}

	if rootNode.Kind != "Pod" {
		t.Errorf("expected Kind=Pod, got %s", rootNode.Kind)
	}
	if rootNode.Namespace != "default" {
		t.Errorf("expected Namespace=default, got %s", rootNode.Namespace)
	}
	if rootNode.Name != "crashy-pod" {
		t.Errorf("expected Name=crashy-pod, got %s", rootNode.Name)
	}
	if rootNode.EventReason != "BackOff" {
		t.Errorf("expected EventReason=BackOff, got %s", rootNode.EventReason)
	}
	if rootNode.HealthStatus != "critical" {
		t.Errorf("expected HealthStatus=critical, got %s", rootNode.HealthStatus)
	}
	if rootNode.ResourceKey != "default/Pod/crashy-pod" {
		t.Errorf("expected ResourceKey=default/Pod/crashy-pod, got %s", rootNode.ResourceKey)
	}

	// --- Effect node for the link ---
	effectNode := CausalNode{
		ResourceKey:  "default/Pod/crashy-pod",
		Kind:         "Pod",
		Namespace:    "default",
		Name:         "crashy-pod",
		EventReason:  "Killing",
		EventMessage: "Stopping container due to failed liveness probe",
		Timestamp:    now.Add(30 * time.Second),
		HealthStatus: "unhealthy",
	}

	// --- CausalLinkV2 ---
	link := CausalLinkV2{
		Cause:       rootNode,
		Effect:      effectNode,
		Rule:        "crash_loop_backoff",
		Confidence:  0.90,
		TimeDeltaMs: 30000,
	}

	if link.Rule != "crash_loop_backoff" {
		t.Errorf("expected Rule=crash_loop_backoff, got %s", link.Rule)
	}
	if link.Confidence != 0.90 {
		t.Errorf("expected Confidence=0.90, got %f", link.Confidence)
	}
	if link.TimeDeltaMs != 30000 {
		t.Errorf("expected TimeDeltaMs=30000, got %d", link.TimeDeltaMs)
	}
	if link.Cause.Kind != "Pod" {
		t.Errorf("expected Cause.Kind=Pod, got %s", link.Cause.Kind)
	}
	if link.Effect.EventReason != "Killing" {
		t.Errorf("expected Effect.EventReason=Killing, got %s", link.Effect.EventReason)
	}

	// --- CausalChain ---
	chain := CausalChain{
		ID:         "chain-001",
		ClusterID:  "cluster-abc",
		InsightID:  "insight-xyz",
		RootCause:  rootNode,
		Links:      []CausalLinkV2{link},
		Confidence: 0.90,
		Status:     "confirmed",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if chain.ID != "chain-001" {
		t.Errorf("expected ID=chain-001, got %s", chain.ID)
	}
	if chain.ClusterID != "cluster-abc" {
		t.Errorf("expected ClusterID=cluster-abc, got %s", chain.ClusterID)
	}
	if chain.InsightID != "insight-xyz" {
		t.Errorf("expected InsightID=insight-xyz, got %s", chain.InsightID)
	}
	if chain.RootCause.Kind != "Pod" {
		t.Errorf("expected RootCause.Kind=Pod, got %s", chain.RootCause.Kind)
	}
	if len(chain.Links) != 1 {
		t.Errorf("expected 1 link, got %d", len(chain.Links))
	}
	if chain.Confidence != 0.90 {
		t.Errorf("expected Confidence=0.90, got %f", chain.Confidence)
	}
	if chain.Status != "confirmed" {
		t.Errorf("expected Status=confirmed, got %s", chain.Status)
	}
	if chain.CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set")
	}
	if chain.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}
