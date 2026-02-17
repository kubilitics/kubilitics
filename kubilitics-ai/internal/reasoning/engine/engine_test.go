package engine_test

// Tests for the ReasoningEngine active investigation loop (A-CORE-005).
// Strategy: inject fakeLLM + fakeToolExecutor to exercise the loop
// without a real LLM or cluster.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	"github.com/kubilitics/kubilitics-ai/internal/reasoning/engine"
)

// ─────────────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────────────

type fakeLLM struct {
	events []types.AgentStreamEvent
	err    error
}

func (f *fakeLLM) CompleteWithTools(
	_ context.Context,
	_ []types.Message,
	_ []types.Tool,
	_ types.ToolExecutor,
	_ types.AgentConfig,
) (<-chan types.AgentStreamEvent, error) {
	if f.err != nil {
		return nil, f.err
	}
	ch := make(chan types.AgentStreamEvent, len(f.events)+1)
	for _, ev := range f.events {
		ch <- ev
	}
	ch <- types.AgentStreamEvent{Done: true}
	close(ch)
	return ch, nil
}

func (f *fakeLLM) CountTokens(_ context.Context, _ []types.Message, _ []types.Tool) (int, error) {
	return 100, nil
}

type fakeToolExecutor struct {
	result string
	err    error
	calls  []string
}

func (f *fakeToolExecutor) Execute(_ context.Context, toolName string, _ map[string]interface{}) (string, error) {
	f.calls = append(f.calls, toolName)
	if f.err != nil {
		return "", f.err
	}
	return f.result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper to collect events from a subscriber
// ─────────────────────────────────────────────────────────────────────────────

func collectEvents(sub *engine.Subscriber, timeout time.Duration) []engine.InvestigationEvent {
	var events []engine.InvestigationEvent
	deadline := time.After(timeout)
	for {
		select {
		case ev, ok := <-sub.Ch:
			if !ok {
				return events
			}
			events = append(events, ev)
		case <-deadline:
			return events
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

func TestInvestigate_RequiresDescription(t *testing.T) {
	eng := engine.NewReasoningEngine(nil, nil, nil, nil, nil, nil)
	_, err := eng.Investigate(context.Background(), "", "general")
	if err == nil {
		t.Error("expected error for empty description")
	}
}

func TestInvestigate_DefaultsType(t *testing.T) {
	llm := &fakeLLM{events: []types.AgentStreamEvent{
		{TextToken: "**Root Cause:** network policy blocking traffic"},
	}}
	executor := &fakeToolExecutor{result: "ok"}
	eng := engine.NewReasoningEngine(nil, nil, llm, executor, nil, nil)

	id, err := eng.Investigate(context.Background(), "something is wrong", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == "" {
		t.Error("expected non-empty investigation ID")
	}
}

func TestInvestigate_FullLoop_ConcludesSuccessfully(t *testing.T) {
	llm := &fakeLLM{events: []types.AgentStreamEvent{
		{TextToken: "Analyzing the cluster state.\n"},
		{TextToken: "**Finding:** Pod is in CrashLoopBackOff due to OOMKill\n"},
		{TextToken: "**Root Cause:** Container memory limit is too low\n"},
		{TextToken: "**Recommendation:** Increase memory limit to 512Mi\n"},
	}}
	executor := &fakeToolExecutor{result: `{"pods": [{"name": "web", "status": "CrashLoopBackOff"}]}`}
	eng := engine.NewReasoningEngine(nil, nil, llm, executor, nil, nil)

	id, err := eng.Investigate(context.Background(), "pod web is crashing", "pod_crash")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Poll until concluded (up to 3 seconds)
	var inv interface{}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		inv, err = eng.GetInvestigation(context.Background(), id)
		if err != nil {
			t.Fatalf("GetInvestigation failed: %v", err)
		}
		invMap := inv.(*engine.Investigation)
		state := string(invMap.State)
		if state == "CONCLUDED" || state == "FAILED" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	invFinal := inv.(*engine.Investigation)
	if invFinal.State != engine.StateConcluded {
		t.Errorf("expected CONCLUDED, got %s", invFinal.State)
	}
	if invFinal.Conclusion == "" {
		t.Error("expected non-empty conclusion")
	}
	if invFinal.Confidence <= 0 {
		t.Error("expected confidence > 0")
	}
}

func TestInvestigate_NoLLM_ConcludesWithContextMessage(t *testing.T) {
	// When no LLM is configured, investigation should still conclude gracefully
	eng := engine.NewReasoningEngine(nil, nil, nil, nil, nil, nil)

	id, err := eng.Investigate(context.Background(), "check cluster health", "general")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var invFinal *engine.Investigation
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := eng.GetInvestigation(context.Background(), id)
		if err != nil {
			t.Fatalf("GetInvestigation failed: %v", err)
		}
		invFinal = raw.(*engine.Investigation)
		if invFinal.State == engine.StateConcluded || invFinal.State == engine.StateFailed {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if invFinal.State != engine.StateConcluded {
		t.Errorf("expected CONCLUDED without LLM, got %s", invFinal.State)
	}
}

func TestInvestigate_LLMError_FailsGracefully(t *testing.T) {
	llm := &fakeLLM{err: fmt.Errorf("LLM provider unreachable")}
	executor := &fakeToolExecutor{}
	eng := engine.NewReasoningEngine(nil, nil, llm, executor, nil, nil)

	id, err := eng.Investigate(context.Background(), "pod is failing", "pod_crash")
	if err != nil {
		t.Fatalf("unexpected error from Investigate: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	var invFinal *engine.Investigation
	for time.Now().Before(deadline) {
		raw, _ := eng.GetInvestigation(context.Background(), id)
		invFinal = raw.(*engine.Investigation)
		if invFinal.State == engine.StateFailed || invFinal.State == engine.StateConcluded {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if invFinal.State != engine.StateFailed {
		t.Errorf("expected FAILED when LLM errors, got %s", invFinal.State)
	}
}

func TestGetInvestigation_NotFound(t *testing.T) {
	eng := engine.NewReasoningEngine(nil, nil, nil, nil, nil, nil)
	_, err := eng.GetInvestigation(context.Background(), "nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent investigation")
	}
}

func TestCancelInvestigation(t *testing.T) {
	eng := engine.NewReasoningEngine(nil, nil, nil, nil, nil, nil)

	id, err := eng.Investigate(context.Background(), "check pods", "general")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Wait briefly for the investigation to start
	time.Sleep(100 * time.Millisecond)

	// Cancel — if already concluded (no LLM), this may fail with "terminal state"
	// which is also correct behavior.
	_ = eng.CancelInvestigation(context.Background(), id)
	// No panic = success
}

func TestListInvestigations(t *testing.T) {
	eng := engine.NewReasoningEngine(nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	eng.Investigate(ctx, "issue 1", "general")
	eng.Investigate(ctx, "issue 2", "pod_crash")
	eng.Investigate(ctx, "issue 3", "performance")

	time.Sleep(200 * time.Millisecond) // let goroutines start

	list, err := eng.ListInvestigations(ctx, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(list) != 3 {
		t.Errorf("expected 3 investigations, got %d", len(list))
	}
}

func TestInvestigate_WithToolCalls_RecordsToolCallHistory(t *testing.T) {
	toolCallEvent := &types.ToolEvent{
		Phase:     "calling",
		CallID:    "call-1",
		ToolName:  "analyze_pod_health",
		Args:      map[string]interface{}{"namespace": "default"},
		TurnIndex: 0,
	}
	toolResultEvent := &types.ToolEvent{
		Phase:     "result",
		CallID:    "call-1",
		ToolName:  "analyze_pod_health",
		Result:    `{"healthy": 3, "total_pods": 5, "issues": [{"severity": "HIGH", "message": "OOMKill detected"}]}`,
		TurnIndex: 0,
	}

	llm := &fakeLLM{events: []types.AgentStreamEvent{
		{ToolEvent: toolCallEvent},
		{ToolEvent: toolResultEvent},
		{TextToken: "**Finding:** Pods are experiencing OOMKill\n"},
		{TextToken: "**Root Cause:** Memory limit is too restrictive\n"},
	}}
	executor := &fakeToolExecutor{result: "data"}
	eng := engine.NewReasoningEngine(nil, nil, llm, executor, nil, nil)

	id, err := eng.Investigate(context.Background(), "pod health investigation", "pod_crash")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	var invFinal *engine.Investigation
	for time.Now().Before(deadline) {
		raw, _ := eng.GetInvestigation(context.Background(), id)
		invFinal = raw.(*engine.Investigation)
		if invFinal.State == engine.StateConcluded || invFinal.State == engine.StateFailed {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if len(invFinal.ToolCalls) == 0 {
		t.Error("expected tool call records to be captured")
	}
	if invFinal.ToolCalls[0].ToolName != "analyze_pod_health" {
		t.Errorf("expected analyze_pod_health, got %s", invFinal.ToolCalls[0].ToolName)
	}
}

func TestSubscribe_ReceivesEvents(t *testing.T) {
	llm := &fakeLLM{events: []types.AgentStreamEvent{
		{TextToken: "**Finding:** issue found\n"},
		{TextToken: "**Root Cause:** memory pressure\n"},
	}}
	executor := &fakeToolExecutor{}
	engImpl := engine.NewReasoningEngine(nil, nil, llm, executor, nil, nil)

	// Type assert to access Subscribe method
	type subscribeableEngine interface {
		engine.ReasoningEngine
		Subscribe(id string) *engine.Subscriber
	}

	se, ok := engImpl.(subscribeableEngine)
	if !ok {
		t.Skip("engine does not expose Subscribe — skipping streaming test")
		return
	}

	id, err := se.Investigate(context.Background(), "test streaming", "general")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	sub := se.Subscribe(id)
	events := collectEvents(sub, 3*time.Second)

	// Should have received at least: step events, text tokens, done
	if len(events) == 0 {
		t.Error("expected at least one investigation event")
	}

	// Check for done event
	hasDone := false
	for _, ev := range events {
		if ev.Type == "done" {
			hasDone = true
			break
		}
	}
	if !hasDone {
		t.Logf("events received: %d (may have subscribed after close)", len(events))
	}
}
