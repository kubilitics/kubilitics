package repository

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	dbmigrations "github.com/kubilitics/kubilitics-backend/migrations"
)

func setupFleetRepo(t *testing.T) (*SQLiteRepository, context.Context) {
	t.Helper()
	ctx := context.Background()

	dbPath := filepath.Join(t.TempDir(), "fleet_repo.db")
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

func TestInsertAndGetLatestFleetHealth(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	record := &models.FleetHealthRecord{
		ClusterID:      "cluster-1",
		Timestamp:      time.Now().UTC(),
		HealthScore:    85.5,
		SPOFCount:      3,
		PDBCoverage:    0.75,
		HPACoverage:    0.60,
		NetPolCoverage: 0.40,
		CriticalCount:  2,
		TotalWorkloads: 50,
		MetricsJSON:    `{"extra": "data"}`,
	}

	err := repo.InsertFleetHealth(ctx, record)
	if err != nil {
		t.Fatalf("Failed to insert fleet health: %v", err)
	}

	got, err := repo.GetLatestFleetHealth(ctx, "cluster-1")
	if err != nil {
		t.Fatalf("Failed to get latest fleet health: %v", err)
	}
	if got == nil {
		t.Fatal("Expected record, got nil")
	}
	if got.HealthScore != 85.5 {
		t.Errorf("Expected health score 85.5, got %f", got.HealthScore)
	}
	if got.SPOFCount != 3 {
		t.Errorf("Expected SPOF count 3, got %d", got.SPOFCount)
	}
	if got.TotalWorkloads != 50 {
		t.Errorf("Expected total workloads 50, got %d", got.TotalWorkloads)
	}
}

func TestGetLatestFleetHealth_NotFound(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	got, err := repo.GetLatestFleetHealth(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("Expected nil error for not-found, got: %v", err)
	}
	if got != nil {
		t.Error("Expected nil record for not-found")
	}
}

func TestGetFleetHealthHistory(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	base := time.Now().UTC().Add(-2 * time.Hour)
	for i := 0; i < 5; i++ {
		err := repo.InsertFleetHealth(ctx, &models.FleetHealthRecord{
			ClusterID:      "cluster-1",
			Timestamp:      base.Add(time.Duration(i) * 30 * time.Minute),
			HealthScore:    float64(80 + i),
			SPOFCount:      i,
			PDBCoverage:    0.5,
			HPACoverage:    0.5,
			NetPolCoverage: 0.5,
			CriticalCount:  0,
			TotalWorkloads: 10,
			MetricsJSON:    "{}",
		})
		if err != nil {
			t.Fatalf("Failed to insert fleet health %d: %v", i, err)
		}
	}

	from := base
	to := base.Add(2 * time.Hour)
	records, err := repo.GetFleetHealthHistory(ctx, "cluster-1", from, to)
	if err != nil {
		t.Fatalf("Failed to get fleet health history: %v", err)
	}
	if len(records) != 5 {
		t.Errorf("Expected 5 records, got %d", len(records))
	}

	// Narrow time range
	from2 := base.Add(30 * time.Minute)
	to2 := base.Add(90 * time.Minute)
	records, err = repo.GetFleetHealthHistory(ctx, "cluster-1", from2, to2)
	if err != nil {
		t.Fatalf("Failed to get narrow fleet health history: %v", err)
	}
	if len(records) != 3 {
		t.Errorf("Expected 3 records in narrow range, got %d", len(records))
	}
}

func TestCreateAndGetGoldenTemplate(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	tpl := &models.GoldenTemplate{
		ID:           "tpl-001",
		Name:         "production-standard",
		Description:  "Standard for production clusters",
		Requirements: `{"min_health_score": 80, "max_spofs": 0, "min_pdb_coverage": 0.9}`,
		CreatedBy:    "admin",
	}

	err := repo.CreateGoldenTemplate(ctx, tpl)
	if err != nil {
		t.Fatalf("Failed to create golden template: %v", err)
	}

	got, err := repo.GetGoldenTemplate(ctx, "tpl-001")
	if err != nil {
		t.Fatalf("Failed to get golden template: %v", err)
	}
	if got.Name != "production-standard" {
		t.Errorf("Expected name 'production-standard', got '%s'", got.Name)
	}
	if got.CreatedBy != "admin" {
		t.Errorf("Expected created_by 'admin', got '%s'", got.CreatedBy)
	}
}

func TestGetGoldenTemplate_NotFound(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	_, err := repo.GetGoldenTemplate(ctx, "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent template")
	}
}

func TestListGoldenTemplates(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	for _, name := range []string{"alpha", "bravo", "charlie"} {
		err := repo.CreateGoldenTemplate(ctx, &models.GoldenTemplate{
			ID:           "tpl-" + name,
			Name:         name,
			Requirements: "{}",
		})
		if err != nil {
			t.Fatalf("Failed to create template %s: %v", name, err)
		}
	}

	templates, err := repo.ListGoldenTemplates(ctx)
	if err != nil {
		t.Fatalf("Failed to list templates: %v", err)
	}
	if len(templates) != 3 {
		t.Errorf("Expected 3 templates, got %d", len(templates))
	}
	// Should be sorted by name ASC
	if len(templates) >= 3 && templates[0].Name != "alpha" {
		t.Errorf("Expected first template 'alpha', got '%s'", templates[0].Name)
	}
}

func TestUpdateGoldenTemplate(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	tpl := &models.GoldenTemplate{
		ID:           "tpl-update",
		Name:         "original-name",
		Description:  "original",
		Requirements: `{"min_health_score": 70}`,
	}
	err := repo.CreateGoldenTemplate(ctx, tpl)
	if err != nil {
		t.Fatalf("Failed to create template: %v", err)
	}

	tpl.Name = "updated-name"
	tpl.Description = "updated"
	tpl.Requirements = `{"min_health_score": 90}`
	err = repo.UpdateGoldenTemplate(ctx, tpl)
	if err != nil {
		t.Fatalf("Failed to update template: %v", err)
	}

	got, err := repo.GetGoldenTemplate(ctx, "tpl-update")
	if err != nil {
		t.Fatalf("Failed to get updated template: %v", err)
	}
	if got.Name != "updated-name" {
		t.Errorf("Expected name 'updated-name', got '%s'", got.Name)
	}
	if got.Description != "updated" {
		t.Errorf("Expected description 'updated', got '%s'", got.Description)
	}
}

func TestUpdateGoldenTemplate_NotFound(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	err := repo.UpdateGoldenTemplate(ctx, &models.GoldenTemplate{
		ID:           "nonexistent",
		Name:         "test",
		Requirements: "{}",
	})
	if err == nil {
		t.Error("Expected error for non-existent template")
	}
}

func TestDeleteGoldenTemplate(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	err := repo.CreateGoldenTemplate(ctx, &models.GoldenTemplate{
		ID:           "tpl-delete",
		Name:         "to-delete",
		Requirements: "{}",
	})
	if err != nil {
		t.Fatalf("Failed to create template: %v", err)
	}

	err = repo.DeleteGoldenTemplate(ctx, "tpl-delete")
	if err != nil {
		t.Fatalf("Failed to delete template: %v", err)
	}

	_, err = repo.GetGoldenTemplate(ctx, "tpl-delete")
	if err == nil {
		t.Error("Template should be deleted")
	}
}

func TestDeleteGoldenTemplate_NotFound(t *testing.T) {
	repo, ctx := setupFleetRepo(t)

	err := repo.DeleteGoldenTemplate(ctx, "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent template")
	}
}
