package repository

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	dbmigrations "github.com/kubilitics/kubilitics-backend/migrations"
)

func setupAutoPilotRepo(t *testing.T) (*SQLiteRepository, context.Context) {
	t.Helper()
	ctx := context.Background()

	dbPath := filepath.Join(t.TempDir(), "autopilot_repo.db")
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("create sqlite repo: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })

	entries, err := dbmigrations.FS.ReadDir(".")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		sqlBytes, readErr := dbmigrations.FS.ReadFile(entry.Name())
		if readErr != nil {
			t.Fatalf("read migration %s: %v", entry.Name(), readErr)
		}
		if runErr := repo.RunMigrations(string(sqlBytes)); runErr != nil {
			t.Fatalf("run migration %s: %v", entry.Name(), runErr)
		}
	}

	return repo, ctx
}

func TestUpsertAutoPilotConfig(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	config := &models.AutoPilotConfig{
		ClusterID:         "cluster-1",
		RuleID:            "rule-restart-crashing-pods",
		Mode:              "audit",
		Enabled:           true,
		NamespaceIncludes: "",
		NamespaceExcludes: "kube-system",
		CooldownMinutes:   30,
	}

	err := repo.UpsertAutoPilotConfig(ctx, config)
	if err != nil {
		t.Fatalf("Failed to upsert autopilot config: %v", err)
	}

	// Verify it was created
	got, err := repo.GetAutoPilotConfig(ctx, "cluster-1", "rule-restart-crashing-pods")
	if err != nil {
		t.Fatalf("Failed to get autopilot config: %v", err)
	}
	if got == nil {
		t.Fatal("Expected config, got nil")
	}
	if got.Mode != "audit" {
		t.Errorf("Expected mode 'audit', got '%s'", got.Mode)
	}
	if got.CooldownMinutes != 30 {
		t.Errorf("Expected cooldown 30, got %d", got.CooldownMinutes)
	}

	// Update via upsert
	config.Mode = "auto"
	config.CooldownMinutes = 15
	err = repo.UpsertAutoPilotConfig(ctx, config)
	if err != nil {
		t.Fatalf("Failed to upsert (update) autopilot config: %v", err)
	}

	got, err = repo.GetAutoPilotConfig(ctx, "cluster-1", "rule-restart-crashing-pods")
	if err != nil {
		t.Fatalf("Failed to get updated config: %v", err)
	}
	if got.Mode != "auto" {
		t.Errorf("Expected mode 'auto' after upsert, got '%s'", got.Mode)
	}
	if got.CooldownMinutes != 15 {
		t.Errorf("Expected cooldown 15 after upsert, got %d", got.CooldownMinutes)
	}
}

func TestGetAutoPilotConfig_NotFound(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	got, err := repo.GetAutoPilotConfig(ctx, "nonexistent", "nonexistent")
	if err != nil {
		t.Fatalf("Expected nil error for not-found, got: %v", err)
	}
	if got != nil {
		t.Error("Expected nil config for not-found")
	}
}

func TestListAutoPilotConfigs(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	for _, ruleID := range []string{"rule-a", "rule-b", "rule-c"} {
		err := repo.UpsertAutoPilotConfig(ctx, &models.AutoPilotConfig{
			ClusterID:       "cluster-1",
			RuleID:          ruleID,
			Mode:            "audit",
			Enabled:         true,
			CooldownMinutes: 60,
		})
		if err != nil {
			t.Fatalf("Failed to upsert config for %s: %v", ruleID, err)
		}
	}

	configs, err := repo.ListAutoPilotConfigs(ctx, "cluster-1")
	if err != nil {
		t.Fatalf("Failed to list configs: %v", err)
	}
	if len(configs) != 3 {
		t.Errorf("Expected 3 configs, got %d", len(configs))
	}

	// Different cluster should return empty
	configs, err = repo.ListAutoPilotConfigs(ctx, "cluster-other")
	if err != nil {
		t.Fatalf("Failed to list configs for other cluster: %v", err)
	}
	if len(configs) != 0 {
		t.Errorf("Expected 0 configs for other cluster, got %d", len(configs))
	}
}

func TestCreateAndGetAutoPilotAction(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	action := &models.AutoPilotAction{
		ID:               "action-001",
		ClusterID:        "cluster-1",
		RuleID:           "rule-restart-crashing-pods",
		TargetKind:       "Deployment",
		TargetNamespace:  "default",
		TargetName:       "my-app",
		ActionType:       "restart",
		Status:           "pending",
		Severity:         "high",
		Description:      "Restart crashing pods in my-app",
		BeforeState:      `{"replicas": 3, "ready": 1}`,
		AfterState:       `{"replicas": 3, "ready": 3}`,
		SimulationResult: `{"impact": "low"}`,
		CreatedAt:        time.Now().UTC(),
		RollbackState:    `{}`,
	}

	err := repo.CreateAutoPilotAction(ctx, action)
	if err != nil {
		t.Fatalf("Failed to create autopilot action: %v", err)
	}

	got, err := repo.GetAutoPilotAction(ctx, "action-001")
	if err != nil {
		t.Fatalf("Failed to get autopilot action: %v", err)
	}
	if got.TargetName != "my-app" {
		t.Errorf("Expected target name 'my-app', got '%s'", got.TargetName)
	}
	if got.Status != "pending" {
		t.Errorf("Expected status 'pending', got '%s'", got.Status)
	}
	if got.Severity != "high" {
		t.Errorf("Expected severity 'high', got '%s'", got.Severity)
	}
}

func TestGetAutoPilotAction_NotFound(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	_, err := repo.GetAutoPilotAction(ctx, "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent action")
	}
}

func TestListAutoPilotActions(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	// Create 5 actions, 3 pending, 2 applied
	for i := 0; i < 5; i++ {
		status := "pending"
		if i >= 3 {
			status = "applied"
		}
		err := repo.CreateAutoPilotAction(ctx, &models.AutoPilotAction{
			ID:              fmt.Sprintf("action-%03d", i),
			ClusterID:       "cluster-1",
			RuleID:          "rule-a",
			TargetKind:      "Deployment",
			TargetNamespace: "default",
			TargetName:      fmt.Sprintf("app-%d", i),
			ActionType:      "scale",
			Status:          status,
			Severity:        "medium",
			BeforeState:     "{}",
			AfterState:      "{}",
			SimulationResult: "{}",
			CreatedAt:       time.Now().UTC(),
			RollbackState:   "{}",
		})
		if err != nil {
			t.Fatalf("Failed to create action %d: %v", i, err)
		}
	}

	// List all for cluster
	actions, total, err := repo.ListAutoPilotActions(ctx, "cluster-1", "", 10, 0)
	if err != nil {
		t.Fatalf("Failed to list actions: %v", err)
	}
	if total != 5 {
		t.Errorf("Expected total 5, got %d", total)
	}
	if len(actions) != 5 {
		t.Errorf("Expected 5 actions, got %d", len(actions))
	}

	// Filter by status
	actions, total, err = repo.ListAutoPilotActions(ctx, "cluster-1", "pending", 10, 0)
	if err != nil {
		t.Fatalf("Failed to list pending actions: %v", err)
	}
	if total != 3 {
		t.Errorf("Expected total 3 pending, got %d", total)
	}
	if len(actions) != 3 {
		t.Errorf("Expected 3 pending actions, got %d", len(actions))
	}

	// Pagination
	actions, total, err = repo.ListAutoPilotActions(ctx, "cluster-1", "", 2, 0)
	if err != nil {
		t.Fatalf("Failed to list with pagination: %v", err)
	}
	if total != 5 {
		t.Errorf("Expected total 5 with pagination, got %d", total)
	}
	if len(actions) != 2 {
		t.Errorf("Expected 2 actions with limit=2, got %d", len(actions))
	}
}

func TestUpdateAutoPilotActionStatus(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	err := repo.CreateAutoPilotAction(ctx, &models.AutoPilotAction{
		ID:               "action-status-test",
		ClusterID:        "cluster-1",
		RuleID:           "rule-a",
		TargetKind:       "Deployment",
		TargetNamespace:  "default",
		TargetName:       "app-1",
		ActionType:       "scale",
		Status:           "pending",
		Severity:         "medium",
		BeforeState:      "{}",
		AfterState:       "{}",
		SimulationResult: "{}",
		CreatedAt:        time.Now().UTC(),
		RollbackState:    "{}",
	})
	if err != nil {
		t.Fatalf("Failed to create action: %v", err)
	}

	err = repo.UpdateAutoPilotActionStatus(ctx, "action-status-test", "applied", "admin-user")
	if err != nil {
		t.Fatalf("Failed to update action status: %v", err)
	}

	got, err := repo.GetAutoPilotAction(ctx, "action-status-test")
	if err != nil {
		t.Fatalf("Failed to get action after status update: %v", err)
	}
	if got.Status != "applied" {
		t.Errorf("Expected status 'applied', got '%s'", got.Status)
	}
	if got.AppliedBy != "admin-user" {
		t.Errorf("Expected applied_by 'admin-user', got '%s'", got.AppliedBy)
	}
	if got.AppliedAt == nil {
		t.Error("Expected applied_at to be set")
	}
}

func TestUpdateAutoPilotActionStatus_NotFound(t *testing.T) {
	repo, ctx := setupAutoPilotRepo(t)

	err := repo.UpdateAutoPilotActionStatus(ctx, "nonexistent", "applied", "admin")
	if err == nil {
		t.Error("Expected error for non-existent action")
	}
}
