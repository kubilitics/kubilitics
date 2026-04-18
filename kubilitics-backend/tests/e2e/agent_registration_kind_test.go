//go:build e2e

package e2e

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// TestAgentRegistrationKind spins up a kind cluster, installs the hub + agent
// via Helm, and asserts that the agent registers and heartbeats successfully by
// querying the agent_clusters table in the hub's SQLite database.
//
// Run with: go test -v -tags=e2e ./tests/e2e/... -timeout 15m
//
// Requirements: docker, kind, kubectl, helm, sqlite3 on PATH.
func TestAgentRegistrationKind(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	// thisFile: .../kubilitics-backend/tests/e2e/agent_registration_kind_test.go
	// repoRoot: three levels up
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..", "..")
	script := filepath.Join(repoRoot, "scripts", "e2e-agent-kind.sh")

	cmd := exec.Command("bash", script)
	out, err := cmd.CombinedOutput()
	t.Log(string(out))
	if err != nil {
		t.Fatal(err)
	}
}
