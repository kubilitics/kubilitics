package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/kubeconfigwatch"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// runRestoreSnapshot is the entry point for the `kubilitics-backend
// restore-snapshot <path>` subcommand. It reads a JSON snapshot produced by
// kubeconfigwatch.WriteSnapshot and re-inserts any clusters referenced in
// the snapshot's AllClusters list that are no longer present in the local
// SQLite registry.
//
// Clusters already present in the DB (matched by ID) are NOT overwritten —
// restore is strictly additive. Running this command twice on the same
// snapshot is idempotent: the second run finds all rows already present
// and skips them.
//
// On any fatal error this function prints to stderr and calls os.Exit(1).
// It never returns to the caller's normal server wiring.
func runRestoreSnapshot(snapshotPath string) {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-snapshot: config load: %v\n", err)
		os.Exit(1)
	}

	data, err := os.ReadFile(snapshotPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-snapshot: read %s: %v\n", snapshotPath, err)
		os.Exit(1)
	}

	var snap kubeconfigwatch.Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		fmt.Fprintf(os.Stderr, "restore-snapshot: parse %s: %v\n", snapshotPath, err)
		os.Exit(1)
	}

	fmt.Printf("Snapshot timestamp: %s\n", snap.Timestamp.Format("2006-01-02 15:04:05 MST"))
	fmt.Printf("Snapshot trigger:   %s\n", snap.Trigger)
	fmt.Printf("Snapshot clusters:  %d\n", len(snap.AllClusters))
	fmt.Println()

	repo, err := repository.NewSQLiteRepository(cfg.DatabasePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-snapshot: open db: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = repo.Close() }()

	ctx := context.Background()
	existing, err := repo.List(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "restore-snapshot: list clusters: %v\n", err)
		os.Exit(1)
	}
	existingIDs := make(map[string]struct{}, len(existing))
	for _, c := range existing {
		existingIDs[c.ID] = struct{}{}
	}

	var restored, skipped int
	for _, rc := range snap.AllClusters {
		if _, ok := existingIDs[rc.ID]; ok {
			skipped++
			continue
		}
		c := &models.Cluster{
			ID:             rc.ID,
			Name:           rc.Name,
			Context:        rc.Context,
			KubeconfigPath: rc.KubeconfigPath,
			ServerURL:      rc.ServerURL,
			Version:        rc.Version,
			Status:         "disconnected",
			Provider:       rc.Provider,
			Source:         rc.Source,
			CreatedAt:      rc.CreatedAt,
			UpdatedAt:      rc.UpdatedAt,
		}
		if err := repo.Create(ctx, c); err != nil {
			fmt.Fprintf(os.Stderr, "restore-snapshot: create %s: %v\n", c.ID, err)
			continue
		}
		restored++
		fmt.Printf("  restored: %s (%s)\n", c.Context, c.ID)
	}

	fmt.Println()
	fmt.Printf("Restore complete: %d restored, %d skipped (already present)\n", restored, skipped)

	// Write a single audit entry per invocation so incident timelines can match
	// auto-removals to their subsequent restores.
	details := map[string]string{
		"snapshot_path":      snapshotPath,
		"snapshot_timestamp": snap.Timestamp.UTC().Format(time.RFC3339),
		"snapshot_trigger":   snap.Trigger,
		"restored_count":     fmt.Sprintf("%d", restored),
		"skipped_count":      fmt.Sprintf("%d", skipped),
		"total_in_snapshot":  fmt.Sprintf("%d", len(snap.AllClusters)),
	}
	detailsJSON, _ := json.Marshal(details)

	entry := &models.AuditLogEntry{
		Action:    "cluster_restored_from_snapshot",
		Username:  "kubeconfig-sync",
		RequestIP: "system",
		Timestamp: time.Now(),
		Details:   string(detailsJSON),
	}
	if err := repo.CreateAuditLog(ctx, entry); err != nil {
		fmt.Fprintf(os.Stderr, "restore-snapshot: warning: failed to write audit entry: %v\n", err)
	}
}
