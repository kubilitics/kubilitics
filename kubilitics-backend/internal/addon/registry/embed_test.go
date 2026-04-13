package registry

import "testing"

func TestLoadCoreCatalog(t *testing.T) {
	files, err := LoadCoreCatalog()
	if err != nil {
		t.Fatalf("load core catalog: %v", err)
	}
	// Assert on a minimum rather than an exact count so adding a new core
	// catalog file (a perfectly normal thing) doesn't require updating this
	// test. Drops are still caught — bumping the floor stays deliberate.
	if len(files) < 12 {
		t.Fatalf("expected at least 12 core catalog files, got %d", len(files))
	}
	seen := make(map[string]bool)
	for i := range files {
		if err := ValidateCatalogFile(files[i]); err != nil {
			t.Fatalf("invalid catalog file %s: %v", files[i].AddOn.ID, err)
		}
		id := files[i].AddOn.ID
		if seen[id] {
			t.Fatalf("duplicate addon ID in catalog: %s", id)
		}
		seen[id] = true
	}
}
