package ai

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Client struct {
	provider Provider
	cfg      Config
	initErr  error
	cacheTTL time.Duration
	cacheMu  sync.Mutex
	cache    map[string]cacheEntry
	usageMu  sync.Mutex
	usage    Usage

	// Rate Limiting
	rateLimit time.Duration
	lastCall  time.Time
	rateMu    sync.Mutex
}

type Request struct {
	Action string `json:"action"`
	Target string `json:"target,omitempty"`
}

type Response struct {
	Result string `json:"result"`
}

type Usage struct {
	TotalCalls       int
	CacheHits        int
	PromptTokens     int
	CompletionTokens int
	EstimatedCostUSD float64
}

type cacheEntry struct {
	value   string
	expires time.Time
}

func NewFromEnv(timeout time.Duration) *Client {
	cfg := ConfigFromEnv(timeout)
	return New(cfg)
}

func New(cfg Config) *Client {
	cfg = cfg.normalized()
	if !cfg.Enabled {
		return &Client{
			cfg:      cfg,
			cacheTTL: 5 * time.Minute,
			cache:    map[string]cacheEntry{},
		}
	}
	provider, err := NewProvider(cfg)
	return &Client{
		provider:  provider,
		cfg:       cfg,
		initErr:   err,
		cacheTTL:  5 * time.Minute,
		cache:     map[string]cacheEntry{},
		rateLimit: 1 * time.Second, // Default 1s between calls
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.cfg.Enabled && (c.provider != nil || strings.TrimSpace(c.cfg.Provider) != "")
}

func (c *Client) ProviderName() string {
	if c == nil || c.provider == nil {
		return "disabled"
	}
	return c.provider.Name()
}

func (c *Client) Analyze(ctx context.Context, action, target string) (string, error) {
	if c == nil {
		return "", fmt.Errorf("ai integration disabled (set KCLI_AI_PROVIDER or provider-specific env vars)")
	}
	if !c.cfg.Enabled {
		return "", fmt.Errorf("ai integration disabled by config")
	}
	if c.initErr != nil {
		return "", c.initErr
	}
	if c.provider == nil {
		return "", fmt.Errorf("ai integration disabled (set KCLI_AI_PROVIDER or provider-specific env vars)")
	}

	action = strings.TrimSpace(strings.ToLower(action))
	target = strings.TrimSpace(target)

	prompt := BuildPrompt(PromptRequest{
		Action: action,
		Target: target,
		Query:  target,
	})

	// Rate Limiting Enforcement
	c.rateMu.Lock()
	elapsed := time.Since(c.lastCall)
	if elapsed < c.rateLimit {
		wait := c.rateLimit - elapsed
		c.rateMu.Unlock()
		time.Sleep(wait)
		c.rateMu.Lock()
	}
	c.lastCall = time.Now()
	c.rateMu.Unlock()

	monthly, err := LoadMonthlyUsage(time.Now())
	if err == nil && c.cfg.BudgetMonthlyUSD > 0 && monthly.EstimatedCostUSD >= c.cfg.BudgetMonthlyUSD {
		return "", fmt.Errorf("ai monthly budget exceeded: $%.2f/$%.2f", monthly.EstimatedCostUSD, c.cfg.BudgetMonthlyUSD)
	}
	fullPrompt := "System:\n" + prompt.System + "\n\nUser:\n" + prompt.User
	cacheKey := c.ProviderName() + "|" + action + "|" + target
	if v, ok := c.getCached(cacheKey); ok {
		c.addUsage(prompt.EstimatedTokens, estimateTokens(v), 0, true)
		return v, nil
	}
	res, err := c.provider.Query(ctx, fullPrompt, &ClusterContext{})
	if err != nil {
		return "", err
	}
	res = strings.TrimSpace(res)
	completionTokens := estimateTokens(res)
	cost := estimateCostUSD(c.ProviderName(), prompt.EstimatedTokens, completionTokens)
	c.addUsage(prompt.EstimatedTokens, completionTokens, cost, false)
	c.setCached(cacheKey, res)
	if monthly, err := LoadMonthlyUsage(time.Now()); err == nil && c.cfg.BudgetMonthlyUSD > 0 {
		soft := c.cfg.BudgetMonthlyUSD * (c.cfg.SoftLimitPercent / 100.0)
		if monthly.EstimatedCostUSD >= soft {
			res += fmt.Sprintf("\n\n[ai-budget] usage $%.2f/$%.2f (soft limit %.0f%% reached)", monthly.EstimatedCostUSD, c.cfg.BudgetMonthlyUSD, c.cfg.SoftLimitPercent)
		}
	}
	return res, nil
}

func (c *Client) Usage() Usage {
	c.usageMu.Lock()
	defer c.usageMu.Unlock()
	return c.usage
}

func (c *Client) getCached(key string) (string, bool) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	v, ok := c.cache[key]
	if !ok {
		return "", false
	}
	if time.Now().After(v.expires) {
		delete(c.cache, key)
		return "", false
	}
	return v.value, true
}

func (c *Client) setCached(key, value string) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	c.cache[key] = cacheEntry{value: value, expires: time.Now().Add(c.cacheTTL)}
}

func (c *Client) addUsage(promptTokens, completionTokens int, cost float64, cacheHit bool) {
	c.usageMu.Lock()
	defer c.usageMu.Unlock()
	c.usage.TotalCalls++
	if cacheHit {
		c.usage.CacheHits++
	}
	c.usage.PromptTokens += max(0, promptTokens)
	c.usage.CompletionTokens += max(0, completionTokens)
	c.usage.EstimatedCostUSD += cost
	_ = RecordUsageDelta(Usage{
		TotalCalls:       1,
		CacheHits:        boolToInt(cacheHit),
		PromptTokens:     max(0, promptTokens),
		CompletionTokens: max(0, completionTokens),
		EstimatedCostUSD: cost,
	}, time.Now())
}

func estimateCostUSD(provider string, promptTokens, completionTokens int) float64 {
	inRate, outRate := 0.0, 0.0
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case ProviderOpenAI:
		inRate, outRate = 0.00015, 0.00060
	case ProviderAnthropic:
		inRate, outRate = 0.00300, 0.01500
	case ProviderAzureOpenAI:
		inRate, outRate = 0.00020, 0.00080
	case ProviderOllama:
		inRate, outRate = 0.0, 0.0
	case ProviderCustom:
		inRate, outRate = 0.0, 0.0
	default:
		inRate, outRate = 0.0, 0.0
	}
	return (float64(max(0, promptTokens))/1000.0)*inRate + (float64(max(0, completionTokens))/1000.0)*outRate
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func ConfigFromEnv(timeout time.Duration) Config {
	provider := strings.TrimSpace(os.Getenv("KCLI_AI_PROVIDER"))
	provider = strings.ToLower(provider)
	if provider == "" {
		switch {
		case strings.TrimSpace(os.Getenv("KCLI_AI_ENDPOINT")) != "":
			provider = ProviderCustom
		case strings.TrimSpace(os.Getenv("KCLI_OPENAI_API_KEY")) != "":
			provider = ProviderOpenAI
		case strings.TrimSpace(os.Getenv("KCLI_ANTHROPIC_API_KEY")) != "":
			provider = ProviderAnthropic
		case strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_API_KEY")) != "":
			provider = ProviderAzureOpenAI
		case strings.TrimSpace(os.Getenv("KCLI_OLLAMA_ENDPOINT")) != "":
			provider = ProviderOllama
		}
	}

	apiKey := strings.TrimSpace(os.Getenv("KCLI_AI_API_KEY"))
	if apiKey == "" {
		switch provider {
		case ProviderOpenAI:
			apiKey = strings.TrimSpace(os.Getenv("KCLI_OPENAI_API_KEY"))
		case ProviderAnthropic:
			apiKey = strings.TrimSpace(os.Getenv("KCLI_ANTHROPIC_API_KEY"))
		case ProviderAzureOpenAI:
			apiKey = strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_API_KEY"))
		}
	}

	endpoint := strings.TrimSpace(os.Getenv("KCLI_AI_ENDPOINT"))
	if endpoint == "" {
		switch provider {
		case ProviderAzureOpenAI:
			endpoint = strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_ENDPOINT"))
		case ProviderOllama:
			endpoint = strings.TrimSpace(os.Getenv("KCLI_OLLAMA_ENDPOINT"))
		}
	}

	cfg := Config{
		Enabled:          provider != "",
		Provider:         provider,
		Endpoint:         endpoint,
		APIKey:           apiKey,
		Model:            strings.TrimSpace(os.Getenv("KCLI_AI_MODEL")),
		Timeout:          timeout,
		AzureDeployment:  strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_DEPLOYMENT")),
		AzureAPIVersion:  strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_API_VERSION")),
		BudgetMonthlyUSD: parseEnvFloat("KCLI_AI_BUDGET_MONTHLY_USD", 50),
		SoftLimitPercent: parseEnvFloat("KCLI_AI_SOFT_LIMIT_PERCENT", 80),
	}
	return cfg.normalized()
}

func MergeEnvOverrides(base Config, timeout time.Duration) Config {
	cfg := base.normalized()
	cfg.Timeout = timeout
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_ENABLED")); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			cfg.Enabled = b
		}
	}
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_PROVIDER")); v != "" {
		cfg.Provider = strings.ToLower(v)
		cfg.Enabled = true
	}
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_MODEL")); v != "" {
		cfg.Model = v
	}
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_ENDPOINT")); v != "" {
		cfg.Endpoint = v
	}
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_API_KEY")); v != "" {
		cfg.APIKey = v
	}
	if cfg.Provider == ProviderOpenAI {
		if v := strings.TrimSpace(os.Getenv("KCLI_OPENAI_API_KEY")); v != "" {
			cfg.APIKey = v
		}
	}
	if cfg.Provider == ProviderAnthropic {
		if v := strings.TrimSpace(os.Getenv("KCLI_ANTHROPIC_API_KEY")); v != "" {
			cfg.APIKey = v
		}
	}
	if cfg.Provider == ProviderAzureOpenAI {
		if v := strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_API_KEY")); v != "" {
			cfg.APIKey = v
		}
		if v := strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_ENDPOINT")); v != "" {
			cfg.Endpoint = v
		}
		if v := strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_DEPLOYMENT")); v != "" {
			cfg.AzureDeployment = v
		}
		if v := strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_API_VERSION")); v != "" {
			cfg.AzureAPIVersion = v
		}
	}
	if cfg.Provider == ProviderOllama {
		if v := strings.TrimSpace(os.Getenv("KCLI_OLLAMA_ENDPOINT")); v != "" {
			cfg.Endpoint = v
		}
	}
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_BUDGET_MONTHLY_USD")); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			cfg.BudgetMonthlyUSD = f
		}
	}
	if v := strings.TrimSpace(os.Getenv("KCLI_AI_SOFT_LIMIT_PERCENT")); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			cfg.SoftLimitPercent = f
		}
	}
	return cfg.normalized()
}

func parseEnvFloat(name string, fallback float64) float64 {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return f
}
