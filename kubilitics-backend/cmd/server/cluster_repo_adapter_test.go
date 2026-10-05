package main

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

type fakeRepoForAdapter struct {
	rows []*models.Cluster
}

func (f *fakeRepoForAdapter) List(ctx context.Context) ([]*models.Cluster, error) {
	return f.rows, nil
}

// VALID-05 regression (docs/VALID-05-INVESTIGATION.md): clusterRepoAdapter
// is the first hop in the chain that previously dropped KubeconfigPath
// entirely between the DB row (models.Cluster, which already stores it) and
// the discovery layer. This confirms the adapter now threads both
// KubeconfigPath and ContextName through, and that a nil row and a row with
// no custom path are both handled without panicking or fabricating a value.
func TestClusterRepoAdapter_ListAll_PropagatesKubeconfigPathAndContext(t *testing.T) {
	repo := &fakeRepoForAdapter{rows: []*models.Cluster{
		{
			ID: "uuid-lab", Name: "lab", ServerURL: "https://lab",
			Context: "kind-kubilitics-scale-lab", KubeconfigPath: "/tmp/kubilitics-lab/kubeconfig.yaml",
			Provider: "Kind",
		},
		{ID: "uuid-default", Name: "default-cluster", ServerURL: "https://default"}, // no custom path/context
		nil, // defensive: adapter already skips nils — must keep doing so
	}}
	adapter := &clusterRepoAdapter{repo: repo}

	got, err := adapter.ListAll()
	if err != nil {
		t.Fatalf("ListAll: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 entries (nil row skipped): %+v", got)
	}

	lab := got[0]
	if lab.KubeconfigPath != "/tmp/kubilitics-lab/kubeconfig.yaml" {
		t.Fatalf("KubeconfigPath not propagated: %q", lab.KubeconfigPath)
	}
	if lab.ContextName != "kind-kubilitics-scale-lab" {
		t.Fatalf("ContextName not propagated: %q", lab.ContextName)
	}
	if lab.SessionID != "uuid-lab" {
		t.Fatalf("SessionID regression: %q", lab.SessionID)
	}

	def := got[1]
	if def.KubeconfigPath != "" || def.ContextName != "" {
		t.Fatalf("expected empty path/context for default cluster, got: %+v", def)
	}
}
