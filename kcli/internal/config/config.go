package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	configDirName  = ".kcli"
	configFileName = "config.yaml"
)

var (
	allowedThemes = map[string]struct{}{
		"ocean":  {},
		"forest": {},
		"amber":  {},
	}
)

type Config struct {
	General     GeneralConfig     `yaml:"general" json:"general"`
	Context     ContextConfig     `yaml:"context" json:"context"`
	TUI         TUIConfig         `yaml:"tui" json:"tui"`
	Logs        LogsConfig        `yaml:"logs" json:"logs"`
	Performance PerformanceConfig `yaml:"performance" json:"performance"`
	Shell       ShellConfig       `yaml:"shell" json:"shell"`
	AI          AIConfig          `yaml:"ai" json:"ai"`
}

type GeneralConfig struct {
	Theme             string `yaml:"theme" json:"theme"`
	StartupTimeBudget string `yaml:"startupTimeBudget" json:"startupTimeBudget"`
}

type ContextConfig struct {
	Favorites   []string            `yaml:"favorites" json:"favorites"`
	Groups      map[string][]string `yaml:"groups" json:"groups"`
	RecentLimit int                 `yaml:"recentLimit" json:"recentLimit"`
}

type TUIConfig struct {
	RefreshInterval string `yaml:"refreshInterval" json:"refreshInterval"`
	Theme           string `yaml:"theme" json:"theme"`
	Colors          bool   `yaml:"colors" json:"colors"`
	Animations      bool   `yaml:"animations" json:"animations"`
}

type LogsConfig struct {
	FollowNewPods bool `yaml:"followNewPods" json:"followNewPods"`
	MaxPods       int  `yaml:"maxPods" json:"maxPods"`
	Colors        bool `yaml:"colors" json:"colors"`
}

type PerformanceConfig struct {
	CacheTTL      string `yaml:"cacheTTL" json:"cacheTTL"`
	MemoryLimitMB int    `yaml:"memoryLimitMB" json:"memoryLimitMB"`
}

type ShellConfig struct {
	PromptFormat string            `yaml:"promptFormat" json:"promptFormat"`
	Aliases      map[string]string `yaml:"aliases" json:"aliases"`
}

type AIConfig struct {
	Enabled          bool    `yaml:"enabled" json:"enabled"`
	Provider         string  `yaml:"provider" json:"provider"`
	Model            string  `yaml:"model" json:"model"`
	APIKey           string  `yaml:"apiKey,omitempty" json:"apiKey,omitempty"`
	Endpoint         string  `yaml:"endpoint,omitempty" json:"endpoint,omitempty"`
	BudgetMonthlyUSD float64 `yaml:"budgetMonthlyUSD" json:"budgetMonthlyUSD"`
	SoftLimitPercent float64 `yaml:"softLimitPercent" json:"softLimitPercent"`
}

func Default() *Config {
	return &Config{
		General: GeneralConfig{
			Theme:             "ocean",
			StartupTimeBudget: "250ms",
		},
		Context: ContextConfig{
			Favorites:   []string{},
			Groups:      map[string][]string{},
			RecentLimit: 10,
		},
		TUI: TUIConfig{
			RefreshInterval: "2s",
			Theme:           "",
			Colors:          true,
			Animations:      true,
		},
		Logs: LogsConfig{
			FollowNewPods: true,
			MaxPods:       20,
			Colors:        true,
		},
		Performance: PerformanceConfig{
			CacheTTL:      "60s",
			MemoryLimitMB: 256,
		},
		Shell: ShellConfig{
			PromptFormat: "[{{.context}}/{{.namespace}}]$ ",
			Aliases:      map[string]string{},
		},
		AI: AIConfig{
			Enabled:          true,
			Provider:         "",
			Model:            "",
			APIKey:           "",
			Endpoint:         "",
			BudgetMonthlyUSD: 50,
			SoftLimitPercent: 80,
		},
	}
}

func FilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, configDirName, configFileName), nil
}

func Load() (*Config, error) {
	path, err := FilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			cfg := Default()
			return cfg, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		cfg := Default()
		return cfg, nil
	}
	cfg := Default()
	if err := yaml.Unmarshal(b, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config YAML: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	cfg.normalize()
	return cfg, nil
}

func Save(cfg *Config) error {
	if cfg == nil {
		return fmt.Errorf("config is nil")
	}
	cfg.normalize()
	if err := cfg.Validate(); err != nil {
		return err
	}
	path, err := FilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func EnsureExists() (string, error) {
	path, err := FilePath()
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(path); err == nil {
		return path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	cfg := Default()
	if err := Save(cfg); err != nil {
		return "", err
	}
	return path, nil
}

func (c *Config) Validate() error {
	if c == nil {
		return fmt.Errorf("config is nil")
	}
	if err := validateTheme(c.General.Theme, "general.theme"); err != nil {
		return err
	}
	if _, err := parsePositiveDuration(c.General.StartupTimeBudget, "general.startupTimeBudget"); err != nil {
		return err
	}
	if c.Context.RecentLimit < 1 || c.Context.RecentLimit > 1000 {
		return fmt.Errorf("context.recentLimit must be between 1 and 1000")
	}
	if err := validateStringSlice(c.Context.Favorites, "context.favorites"); err != nil {
		return err
	}
	for name, members := range c.Context.Groups {
		if strings.TrimSpace(name) == "" {
			return fmt.Errorf("context.groups contains empty group name")
		}
		if err := validateStringSlice(members, "context.groups."+name); err != nil {
			return err
		}
	}
	if _, err := parsePositiveDuration(c.TUI.RefreshInterval, "tui.refreshInterval"); err != nil {
		return err
	}
	if strings.TrimSpace(c.TUI.Theme) != "" {
		if err := validateTheme(c.TUI.Theme, "tui.theme"); err != nil {
			return err
		}
	}
	if c.Logs.MaxPods < 1 || c.Logs.MaxPods > 500 {
		return fmt.Errorf("logs.maxPods must be between 1 and 500")
	}
	if _, err := parsePositiveDuration(c.Performance.CacheTTL, "performance.cacheTTL"); err != nil {
		return err
	}
	if c.Performance.MemoryLimitMB < 64 || c.Performance.MemoryLimitMB > 65536 {
		return fmt.Errorf("performance.memoryLimitMB must be between 64 and 65536")
	}
	if strings.TrimSpace(c.Shell.PromptFormat) == "" {
		return fmt.Errorf("shell.promptFormat cannot be empty")
	}
	for k, v := range c.Shell.Aliases {
		if strings.TrimSpace(k) == "" {
			return fmt.Errorf("shell.aliases contains empty alias name")
		}
		if strings.TrimSpace(v) == "" {
			return fmt.Errorf("shell.aliases.%s cannot be empty", k)
		}
	}
	if c.AI.BudgetMonthlyUSD < 0 {
		return fmt.Errorf("ai.budgetMonthlyUSD must be >= 0")
	}
	if c.AI.SoftLimitPercent <= 0 || c.AI.SoftLimitPercent >= 100 {
		return fmt.Errorf("ai.softLimitPercent must be > 0 and < 100")
	}
	return nil
}

func (c *Config) ResolvedTheme() string {
	if strings.TrimSpace(c.TUI.Theme) != "" {
		return strings.ToLower(strings.TrimSpace(c.TUI.Theme))
	}
	if strings.TrimSpace(c.General.Theme) != "" {
		return strings.ToLower(strings.TrimSpace(c.General.Theme))
	}
	return "ocean"
}

func (c *Config) RefreshIntervalDuration() time.Duration {
	d, err := time.ParseDuration(strings.TrimSpace(c.TUI.RefreshInterval))
	if err != nil || d <= 0 {
		return 2 * time.Second
	}
	return d
}

func (c *Config) SetByKey(key, value string) error {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return fmt.Errorf("key cannot be empty")
	}
	v := strings.TrimSpace(value)
	switch {
	case k == "general.theme":
		c.General.Theme = strings.ToLower(v)
	case k == "general.startuptimebudget", k == "general.startup_time_budget":
		c.General.StartupTimeBudget = v
	case k == "context.recentlimit", k == "context.recent_limit":
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("context.recentLimit must be an integer")
		}
		c.Context.RecentLimit = n
	case k == "context.favorites":
		c.Context.Favorites = parseCSV(v)
	case strings.HasPrefix(k, "context.groups."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "context.groups."))
		if name == "" {
			return fmt.Errorf("context group name is required")
		}
		if c.Context.Groups == nil {
			c.Context.Groups = map[string][]string{}
		}
		c.Context.Groups[name] = parseCSV(v)
	case k == "tui.refreshinterval", k == "tui.refresh_interval":
		c.TUI.RefreshInterval = v
	case k == "tui.theme":
		c.TUI.Theme = strings.ToLower(v)
	case k == "tui.colors":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("tui.colors must be true or false")
		}
		c.TUI.Colors = b
	case k == "tui.animations":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("tui.animations must be true or false")
		}
		c.TUI.Animations = b
	case k == "logs.follownewpods", k == "logs.follow_new_pods":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("logs.followNewPods must be true or false")
		}
		c.Logs.FollowNewPods = b
	case k == "logs.maxpods", k == "logs.max_pods":
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("logs.maxPods must be an integer")
		}
		c.Logs.MaxPods = n
	case k == "logs.colors":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("logs.colors must be true or false")
		}
		c.Logs.Colors = b
	case k == "performance.cachettl", k == "performance.cache_ttl":
		c.Performance.CacheTTL = v
	case k == "performance.memorylimitmb", k == "performance.memory_limit_mb":
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("performance.memoryLimitMB must be an integer")
		}
		c.Performance.MemoryLimitMB = n
	case k == "shell.promptformat", k == "shell.prompt_format":
		c.Shell.PromptFormat = value
	case strings.HasPrefix(k, "shell.aliases."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "shell.aliases."))
		if name == "" {
			return fmt.Errorf("alias name is required")
		}
		if c.Shell.Aliases == nil {
			c.Shell.Aliases = map[string]string{}
		}
		if v == "" {
			delete(c.Shell.Aliases, name)
		} else {
			c.Shell.Aliases[name] = value
		}
	case k == "ai.enabled":
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("ai.enabled must be true or false")
		}
		c.AI.Enabled = b
	case k == "ai.provider":
		c.AI.Provider = strings.ToLower(v)
	case k == "ai.model":
		c.AI.Model = v
	case k == "ai.apikey", k == "ai.api_key":
		c.AI.APIKey = value
	case k == "ai.endpoint":
		c.AI.Endpoint = v
	case k == "ai.budgetmonthlyusd", k == "ai.budget_monthly_usd":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("ai.budgetMonthlyUSD must be a number")
		}
		c.AI.BudgetMonthlyUSD = f
	case k == "ai.softlimitpercent", k == "ai.soft_limit_percent":
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("ai.softLimitPercent must be a number")
		}
		c.AI.SoftLimitPercent = f
	default:
		return fmt.Errorf("unsupported key %q", key)
	}
	c.normalize()
	return c.Validate()
}

func (c *Config) GetByKey(key string) (any, error) {
	k := strings.ToLower(strings.TrimSpace(key))
	if k == "" {
		return nil, fmt.Errorf("key cannot be empty")
	}
	switch {
	case k == "general.theme":
		return c.General.Theme, nil
	case k == "general.startuptimebudget", k == "general.startup_time_budget":
		return c.General.StartupTimeBudget, nil
	case k == "context.recentlimit", k == "context.recent_limit":
		return c.Context.RecentLimit, nil
	case k == "context.favorites":
		return append([]string(nil), c.Context.Favorites...), nil
	case strings.HasPrefix(k, "context.groups."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "context.groups."))
		if name == "" {
			return nil, fmt.Errorf("context group name is required")
		}
		return append([]string(nil), c.Context.Groups[name]...), nil
	case k == "tui.refreshinterval", k == "tui.refresh_interval":
		return c.TUI.RefreshInterval, nil
	case k == "tui.theme":
		return c.TUI.Theme, nil
	case k == "tui.colors":
		return c.TUI.Colors, nil
	case k == "tui.animations":
		return c.TUI.Animations, nil
	case k == "logs.follownewpods", k == "logs.follow_new_pods":
		return c.Logs.FollowNewPods, nil
	case k == "logs.maxpods", k == "logs.max_pods":
		return c.Logs.MaxPods, nil
	case k == "logs.colors":
		return c.Logs.Colors, nil
	case k == "performance.cachettl", k == "performance.cache_ttl":
		return c.Performance.CacheTTL, nil
	case k == "performance.memorylimitmb", k == "performance.memory_limit_mb":
		return c.Performance.MemoryLimitMB, nil
	case k == "shell.promptformat", k == "shell.prompt_format":
		return c.Shell.PromptFormat, nil
	case strings.HasPrefix(k, "shell.aliases."):
		name := strings.TrimSpace(strings.TrimPrefix(k, "shell.aliases."))
		if name == "" {
			return nil, fmt.Errorf("alias name is required")
		}
		v, ok := c.Shell.Aliases[name]
		if !ok {
			return "", nil
		}
		return v, nil
	case k == "ai.enabled":
		return c.AI.Enabled, nil
	case k == "ai.provider":
		return c.AI.Provider, nil
	case k == "ai.model":
		return c.AI.Model, nil
	case k == "ai.apikey", k == "ai.api_key":
		return c.AI.APIKey, nil
	case k == "ai.endpoint":
		return c.AI.Endpoint, nil
	case k == "ai.budgetmonthlyusd", k == "ai.budget_monthly_usd":
		return c.AI.BudgetMonthlyUSD, nil
	case k == "ai.softlimitpercent", k == "ai.soft_limit_percent":
		return c.AI.SoftLimitPercent, nil
	default:
		return nil, fmt.Errorf("unsupported key %q", key)
	}
}

func (c *Config) ToYAML() (string, error) {
	b, err := yaml.Marshal(c)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (c *Config) ToJSON() (string, error) {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func AllowedThemeNames() []string {
	out := make([]string, 0, len(allowedThemes))
	for k := range allowedThemes {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (c *Config) normalize() {
	if c.Context.Groups == nil {
		c.Context.Groups = map[string][]string{}
	}
	if c.Shell.Aliases == nil {
		c.Shell.Aliases = map[string]string{}
	}
	c.General.Theme = strings.ToLower(strings.TrimSpace(c.General.Theme))
	c.TUI.Theme = strings.ToLower(strings.TrimSpace(c.TUI.Theme))
	c.General.StartupTimeBudget = strings.TrimSpace(c.General.StartupTimeBudget)
	c.TUI.RefreshInterval = strings.TrimSpace(c.TUI.RefreshInterval)
	c.Performance.CacheTTL = strings.TrimSpace(c.Performance.CacheTTL)
	c.Shell.PromptFormat = strings.TrimSpace(c.Shell.PromptFormat)
	c.AI.Provider = strings.ToLower(strings.TrimSpace(c.AI.Provider))
	c.AI.Model = strings.TrimSpace(c.AI.Model)
	c.AI.Endpoint = strings.TrimSpace(c.AI.Endpoint)
	c.AI.APIKey = strings.TrimSpace(c.AI.APIKey)
	c.Context.Favorites = dedupeTrimmed(c.Context.Favorites)
	for name, members := range c.Context.Groups {
		cleanName := strings.TrimSpace(name)
		if cleanName == "" {
			delete(c.Context.Groups, name)
			continue
		}
		if cleanName != name {
			delete(c.Context.Groups, name)
		}
		c.Context.Groups[cleanName] = dedupeTrimmed(members)
	}
}

func parseCSV(v string) []string {
	if strings.TrimSpace(v) == "" {
		return []string{}
	}
	parts := strings.Split(v, ",")
	return dedupeTrimmed(parts)
}

func dedupeTrimmed(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func validateTheme(v, key string) error {
	v = strings.ToLower(strings.TrimSpace(v))
	if _, ok := allowedThemes[v]; !ok {
		return fmt.Errorf("%s must be one of: %s", key, strings.Join(AllowedThemeNames(), ", "))
	}
	return nil
}

func parsePositiveDuration(v, key string) (time.Duration, error) {
	d, err := time.ParseDuration(strings.TrimSpace(v))
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid duration: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be > 0", key)
	}
	return d, nil
}

func validateStringSlice(values []string, key string) error {
	for _, v := range values {
		if strings.TrimSpace(v) == "" {
			return fmt.Errorf("%s contains empty values", key)
		}
	}
	return nil
}
