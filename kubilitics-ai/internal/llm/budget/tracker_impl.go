package budget

// Package budget — concrete BudgetTracker implementation.
//
// Design:
//   - In-memory per-user counters (persisted to DB via optional Store hook)
//   - Provider pricing table (cents per 1K tokens)
//   - Soft limit: warn, continue. Hard limit: return ErrBudgetExceeded.
//   - Global daily/monthly limits configurable via BudgetConfig.

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// ─── Pricing ─────────────────────────────────────────────────────────────────

// providerPricing maps provider names to (input, output) cost per 1K tokens in USD.
var providerPricing = map[string][2]float64{
	"anthropic": {0.003, 0.015},  // claude-3.5-sonnet
	"openai":    {0.0025, 0.010}, // gpt-4o
	"ollama":    {0.0, 0.0},      // local, free
	"custom":    {0.001, 0.002},  // configurable default
}

// ─── Types ────────────────────────────────────────────────────────────────────

// UsageEntry tracks token consumption for a single LLM call.
type UsageEntry struct {
	Provider       string
	InvestigationID string
	InputTokens    int
	OutputTokens   int
	CostUSD        float64
	Timestamp      time.Time
}

// UsageSummary aggregates usage for a user.
type UsageSummary struct {
	UserID          string             `json:"user_id"`
	TotalInputTokens  int              `json:"total_input_tokens"`
	TotalOutputTokens int              `json:"total_output_tokens"`
	TotalTokens     int                `json:"total_tokens"`
	TotalCostUSD    float64            `json:"total_cost_usd"`
	ByProvider      map[string]int     `json:"by_provider"`     // provider → total tokens
	ByInvestigation map[string]int     `json:"by_investigation"` // investigation_id → total tokens
	BudgetLimitUSD  float64            `json:"budget_limit_usd"`
	RemainingUSD    float64            `json:"remaining_usd"`
	PeriodStart     time.Time          `json:"period_start"`
}

// BudgetConfig sets global and per-user budget limits.
type BudgetConfig struct {
	// GlobalDailyLimitUSD caps total spending per day. 0 = unlimited.
	GlobalDailyLimitUSD float64
	// DefaultPerUserLimitUSD is the default per-user budget. 0 = unlimited.
	DefaultPerUserLimitUSD float64
	// PerInvestigationLimitTokens caps tokens for a single investigation. 0 = unlimited.
	PerInvestigationLimitTokens int
	// WarnThreshold is the fraction of budget that triggers a warning (e.g. 0.8 = 80%).
	WarnThreshold float64
}

// DefaultBudgetConfig returns sensible defaults (effectively unlimited for local installs).
func DefaultBudgetConfig() *BudgetConfig {
	return &BudgetConfig{
		GlobalDailyLimitUSD:         0,    // unlimited
		DefaultPerUserLimitUSD:      0,    // unlimited
		PerInvestigationLimitTokens: 0,    // unlimited
		WarnThreshold:               0.80, // warn at 80%
	}
}

// ─── Implementation ───────────────────────────────────────────────────────────

type userBudget struct {
	limitUSD    float64
	periodStart time.Time
	entries     []*UsageEntry
}

type budgetTrackerImpl struct {
	mu      sync.RWMutex
	cfg     *BudgetConfig
	users   map[string]*userBudget // userID → budget
	global  []*UsageEntry          // all entries (for global limit)
}

// NewBudgetTracker creates an in-memory budget tracker with default config.
func NewBudgetTracker() BudgetTracker {
	return NewBudgetTrackerWithConfig(DefaultBudgetConfig())
}

// NewBudgetTrackerWithConfig creates a budget tracker with explicit config.
func NewBudgetTrackerWithConfig(cfg *BudgetConfig) BudgetTracker {
	if cfg == nil {
		cfg = DefaultBudgetConfig()
	}
	return &budgetTrackerImpl{
		cfg:   cfg,
		users: make(map[string]*userBudget),
	}
}

func (t *budgetTrackerImpl) getOrCreateUser(userID string) *userBudget {
	if ub, ok := t.users[userID]; ok {
		return ub
	}
	ub := &userBudget{
		limitUSD:    t.cfg.DefaultPerUserLimitUSD,
		periodStart: startOfMonth(),
	}
	t.users[userID] = ub
	return ub
}

// RecordTokenUsage records actual token usage from an LLM call.
func (t *budgetTrackerImpl) RecordTokenUsage(ctx context.Context, userID, investigationID string, inputTokens, outputTokens int, provider string) error {
	cost := calculateCost(provider, inputTokens, outputTokens)
	entry := &UsageEntry{
		Provider:        provider,
		InvestigationID: investigationID,
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		CostUSD:         cost,
		Timestamp:       time.Now(),
	}

	t.mu.Lock()
	ub := t.getOrCreateUser(userID)
	ub.entries = append(ub.entries, entry)
	t.global = append(t.global, entry)
	t.mu.Unlock()

	return nil
}

// GetUsageSummary returns usage summary for a user.
func (t *budgetTrackerImpl) GetUsageSummary(_ context.Context, userID string) (interface{}, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	ub := t.getOrCreateUserRO(userID)
	summary := &UsageSummary{
		UserID:          userID,
		ByProvider:      map[string]int{},
		ByInvestigation: map[string]int{},
		BudgetLimitUSD:  ub.limitUSD,
		PeriodStart:     ub.periodStart,
	}

	for _, e := range ub.entries {
		summary.TotalInputTokens += e.InputTokens
		summary.TotalOutputTokens += e.OutputTokens
		summary.TotalCostUSD += e.CostUSD
		summary.ByProvider[e.Provider] += e.InputTokens + e.OutputTokens
		if e.InvestigationID != "" {
			summary.ByInvestigation[e.InvestigationID] += e.InputTokens + e.OutputTokens
		}
	}
	summary.TotalTokens = summary.TotalInputTokens + summary.TotalOutputTokens
	if ub.limitUSD > 0 {
		summary.RemainingUSD = ub.limitUSD - summary.TotalCostUSD
	}

	return summary, nil
}

// GetUsageDetails returns per-investigation usage breakdown.
func (t *budgetTrackerImpl) GetUsageDetails(_ context.Context, userID, investigationID string) (interface{}, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	ub := t.getOrCreateUserRO(userID)
	var entries []*UsageEntry
	for _, e := range ub.entries {
		if investigationID == "" || e.InvestigationID == investigationID {
			entries = append(entries, e)
		}
	}
	return entries, nil
}

// CheckBudgetAvailable checks if the user has budget for an estimated call.
func (t *budgetTrackerImpl) CheckBudgetAvailable(_ context.Context, userID string, estimatedTokens int) (bool, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()

	ub := t.getOrCreateUserRO(userID)
	if ub.limitUSD <= 0 {
		return true, nil // unlimited
	}
	spent := totalCostForUser(ub)
	remaining := ub.limitUSD - spent
	// Rough estimate: 1K tokens ~ average cost across providers
	estimatedCost := float64(estimatedTokens) / 1000.0 * 0.005
	if remaining < estimatedCost {
		return false, nil
	}
	// Warn threshold
	if remaining < ub.limitUSD*(1-t.cfg.WarnThreshold) {
		return true, fmt.Errorf("budget warning: %.1f%% used (remaining: $%.4f)", (spent/ub.limitUSD)*100, remaining)
	}
	return true, nil
}

// EnforceBudgetLimit returns an error if the user's budget is exhausted.
func (t *budgetTrackerImpl) EnforceBudgetLimit(_ context.Context, userID string) error {
	t.mu.RLock()
	defer t.mu.RUnlock()

	ub := t.getOrCreateUserRO(userID)
	if ub.limitUSD <= 0 {
		return nil // unlimited
	}
	spent := totalCostForUser(ub)
	if spent >= ub.limitUSD {
		return fmt.Errorf("budget exceeded: spent $%.4f of $%.4f limit", spent, ub.limitUSD)
	}
	return nil
}

// GetEstimatedCost estimates the cost for an LLM call.
func (t *budgetTrackerImpl) GetEstimatedCost(_ context.Context, inputTokens, outputTokens int, provider string) (float64, error) {
	return calculateCost(provider, inputTokens, outputTokens), nil
}

// ResetBudget clears usage counters for a user (e.g. on monthly cycle).
func (t *budgetTrackerImpl) ResetBudget(_ context.Context, userID string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	ub := t.getOrCreateUser(userID)
	ub.entries = nil
	ub.periodStart = startOfMonth()
	return nil
}

// SetBudgetLimit sets a spending limit for a user.
func (t *budgetTrackerImpl) SetBudgetLimit(_ context.Context, userID string, limitDollars float64) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.getOrCreateUser(userID).limitUSD = limitDollars
	return nil
}

// GetBudgetLimits returns limit info for a user.
func (t *budgetTrackerImpl) GetBudgetLimits(_ context.Context, userID string) (interface{}, error) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	ub := t.getOrCreateUserRO(userID)
	spent := totalCostForUser(ub)
	return map[string]interface{}{
		"user_id":          userID,
		"limit_usd":        ub.limitUSD,
		"spent_usd":        spent,
		"remaining_usd":    ub.limitUSD - spent,
		"period_start":     ub.periodStart,
		"warn_threshold":   t.cfg.WarnThreshold,
	}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func (t *budgetTrackerImpl) getOrCreateUserRO(userID string) *userBudget {
	if ub, ok := t.users[userID]; ok {
		return ub
	}
	return &userBudget{
		limitUSD:    t.cfg.DefaultPerUserLimitUSD,
		periodStart: startOfMonth(),
	}
}

func totalCostForUser(ub *userBudget) float64 {
	total := 0.0
	for _, e := range ub.entries {
		total += e.CostUSD
	}
	return total
}

func calculateCost(provider string, inputTokens, outputTokens int) float64 {
	p := provider
	pricing, ok := providerPricing[p]
	if !ok {
		pricing = providerPricing["custom"]
	}
	inputCostPer1K := pricing[0]
	outputCostPer1K := pricing[1]
	return (float64(inputTokens)/1000.0)*inputCostPer1K + (float64(outputTokens)/1000.0)*outputCostPer1K
}

func startOfMonth() time.Time {
	now := time.Now().UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}
