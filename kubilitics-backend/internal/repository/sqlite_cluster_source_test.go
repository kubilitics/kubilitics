package repository

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// newTestRepo creates a fresh SQLite repo backed by a temp-dir database file.
// Caller is responsible for cleanup via t.Cleanup. Runs all migrations.
func newTestRepo(t *testing.T) *SQLiteRepository {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	repo, err := NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteRepository: %v", err)
	}

	// Run migrations from embedded FS
	dbmigrations := setupMigrations(t)
	if err := dbmigrations(repo); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	t.Cleanup(func() { _ = repo.Close() })
	return repo
}

// setupMigrations returns a function that runs all migrations for testing.
// This mimics the behavior in cmd/server/main.go
func setupMigrations(t *testing.T) func(*SQLiteRepository) error {
	return func(repo *SQLiteRepository) error {
		t.Helper()
		// Find migrations directory relative to this test file
		candidates := []string{
			"../../migrations",
			"../../../migrations",
		}
		var migDir string
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				abs, _ := filepath.Abs(c)
				migDir = abs
				break
			}
		}
		if migDir == "" {
			t.Fatalf("could not find migrations dir from cwd")
		}

		entries, err := os.ReadDir(migDir)
		if err != nil {
			return err
		}

		for _, entry := range entries {
			if entry.IsDir() || !isSQL(entry.Name()) {
				continue
			}
			migPath := filepath.Join(migDir, entry.Name())
			migSQL, err := os.ReadFile(migPath)
			if err != nil {
				return err
			}
			if err := repo.RunMigrations(string(migSQL)); err != nil {
				return err
			}
		}
		return nil
	}
}

func isSQL(name string) bool {
	return len(name) > 4 && name[len(name)-4:] == ".sql"
}

func TestCluster_SourceFieldRoundTrip(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	c := &models.Cluster{
		Name:           "docker-desktop",
		Context:        "docker-desktop",
		KubeconfigPath: "/home/user/.kube/config",
		ServerURL:      "https://127.0.0.1:6443",
		Version:        "v1.30.0",
		Status:         "connected",
		Provider:       "docker-desktop",
		Source:         "kubeconfig",
		LastConnected:  time.Now(),
	}

	if err := repo.Create(ctx, c); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.Get(ctx, c.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if got.Source != "kubeconfig" {
		t.Errorf("Source: got %q, want %q", got.Source, "kubeconfig")
	}
}

func TestCluster_SourceFieldDefaults(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	// Create without explicitly setting Source — should default to "kubeconfig"
	c := &models.Cluster{
		Name:          "no-source",
		Context:       "no-source",
		ServerURL:     "https://1.2.3.4:6443",
		Status:        "disconnected",
		LastConnected: time.Now(),
	}
	if err := repo.Create(ctx, c); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.Get(ctx, c.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if got.Source != "kubeconfig" {
		t.Errorf("default Source: got %q, want %q", got.Source, "kubeconfig")
	}
}

func TestCluster_SourceUploadPersists(t *testing.T) {
	repo := newTestRepo(t)
	ctx := context.Background()

	c := &models.Cluster{
		Name:           "uploaded",
		Context:        "uploaded",
		KubeconfigPath: "/home/user/.kubilitics/kubeconfigs/uploaded.yaml",
		ServerURL:      "https://1.2.3.4:6443",
		Status:         "disconnected",
		Source:         "upload",
		LastConnected:  time.Now(),
	}
	if err := repo.Create(ctx, c); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.Get(ctx, c.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Source != "upload" {
		t.Errorf("Source: got %q, want %q", got.Source, "upload")
	}
}
