package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	usageDirName  = ".kcli"
	usageFileName = "ai-usage.json"
)

type MonthlyUsage struct {
	Month            string    `json:"month"`
	TotalCalls       int       `json:"totalCalls"`
	CacheHits        int       `json:"cacheHits"`
	PromptTokens     int       `json:"promptTokens"`
	CompletionTokens int       `json:"completionTokens"`
	EstimatedCostUSD float64   `json:"estimatedCostUSD"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

func UsageFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, usageDirName, usageFileName), nil
}

func LoadMonthlyUsage(now time.Time) (*MonthlyUsage, error) {
	path, err := UsageFilePath()
	if err != nil {
		return nil, err
	}
	m := now.Format("2006-01")
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &MonthlyUsage{Month: m}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return &MonthlyUsage{Month: m}, nil
	}
	var u MonthlyUsage
	if err := json.Unmarshal(b, &u); err != nil {
		return nil, fmt.Errorf("failed to parse ai usage store: %w", err)
	}
	if u.Month != m {
		return &MonthlyUsage{Month: m}, nil
	}
	return &u, nil
}

func RecordUsageDelta(delta Usage, now time.Time) error {
	path, err := UsageFilePath()
	if err != nil {
		return err
	}
	u, err := LoadMonthlyUsage(now)
	if err != nil {
		return err
	}
	u.TotalCalls += max(0, delta.TotalCalls)
	u.CacheHits += max(0, delta.CacheHits)
	u.PromptTokens += max(0, delta.PromptTokens)
	u.CompletionTokens += max(0, delta.CompletionTokens)
	u.EstimatedCostUSD += delta.EstimatedCostUSD
	u.UpdatedAt = now.UTC()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(u, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}
