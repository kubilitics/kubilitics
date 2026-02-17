package config

import (
	"path/filepath"
	"testing"
)

func TestLoadDefaultWhenMissing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load error: %v", err)
	}
	if cfg.General.Theme != "ocean" {
		t.Fatalf("expected default theme ocean, got %q", cfg.General.Theme)
	}
}

func TestSaveAndLoadRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg := Default()
	if err := cfg.SetByKey("tui.refresh_interval", "5s"); err != nil {
		t.Fatalf("SetByKey error: %v", err)
	}
	if err := cfg.SetByKey("shell.aliases.kg", "get pods"); err != nil {
		t.Fatalf("SetByKey alias error: %v", err)
	}
	if err := Save(cfg); err != nil {
		t.Fatalf("Save error: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("Load after save error: %v", err)
	}
	if loaded.TUI.RefreshInterval != "5s" {
		t.Fatalf("expected refresh interval 5s, got %q", loaded.TUI.RefreshInterval)
	}
	if loaded.Shell.Aliases["kg"] != "get pods" {
		t.Fatalf("expected alias kg, got %+v", loaded.Shell.Aliases)
	}

	path, err := FilePath()
	if err != nil {
		t.Fatalf("FilePath error: %v", err)
	}
	if want := filepath.Join(home, ".kcli", "config.yaml"); path != want {
		t.Fatalf("unexpected config path %q want %q", path, want)
	}
}

func TestValidateRejectsInvalidValues(t *testing.T) {
	cfg := Default()
	cfg.General.Theme = "invalid"
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid theme error")
	}

	cfg = Default()
	cfg.Logs.MaxPods = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected invalid logs.maxPods error")
	}
}

func TestSetByKeyRejectsInvalidInput(t *testing.T) {
	cfg := Default()
	if err := cfg.SetByKey("performance.memory_limit_mb", "abc"); err == nil {
		t.Fatal("expected memory limit parse error")
	}
	if err := cfg.SetByKey("unknown.key", "x"); err == nil {
		t.Fatal("expected unsupported key error")
	}
}

func TestAIConfigRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg := Default()
	if err := cfg.SetByKey("ai.provider", "openai"); err != nil {
		t.Fatalf("set ai.provider: %v", err)
	}
	if err := cfg.SetByKey("ai.model", "gpt-4o-mini"); err != nil {
		t.Fatalf("set ai.model: %v", err)
	}
	if err := cfg.SetByKey("ai.budget_monthly_usd", "75"); err != nil {
		t.Fatalf("set ai budget: %v", err)
	}
	if err := cfg.SetByKey("ai.soft_limit_percent", "85"); err != nil {
		t.Fatalf("set ai soft limit: %v", err)
	}
	if err := Save(cfg); err != nil {
		t.Fatalf("save config: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if loaded.AI.Provider != "openai" || loaded.AI.Model != "gpt-4o-mini" {
		t.Fatalf("unexpected ai config: %+v", loaded.AI)
	}
	if loaded.AI.BudgetMonthlyUSD != 75 || loaded.AI.SoftLimitPercent != 85 {
		t.Fatalf("unexpected ai budget config: %+v", loaded.AI)
	}
}
