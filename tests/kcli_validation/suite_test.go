package test

import (
	"bytes"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Config
const kcliPath = "../../kcli/bin/kcli"

// TestCase defines a command to run and expected behavior
type TestCase struct {
	Name          string
	Cmd           []string
	ExpectSuccess bool
	ExpectOutput  []string // Substrings that must appear in output
	ExpectError   []string // Substrings that must appear in stderr if it fails
}

func runKCLI(t *testing.T, args []string) (string, string, error) {
	cmd := exec.Command(kcliPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start)

	t.Logf("Executed: kcli %s (took %v)", strings.Join(args, " "), duration)

	if err != nil {
		return stdout.String(), stderr.String(), err
	}
	return stdout.String(), stderr.String(), nil
}

func TestKCLICoreCommands(t *testing.T) {
	tests := []TestCase{
		{
			Name:          "Get Pods All Namespaces",
			Cmd:           []string{"get", "pods", "-A"},
			ExpectSuccess: true,
			ExpectOutput:  []string{"NAMESPACE", "NAME", "READY", "STATUS"},
		},
		{
			Name:          "Get Nodes",
			Cmd:           []string{"get", "nodes"},
			ExpectSuccess: true,
			ExpectOutput:  []string{"NAME", "STATUS", "ROLES"},
		},
		{
			Name:          "Namespace Switch",
			Cmd:           []string{"ns", "default"},
			ExpectSuccess: true,
			ExpectOutput:  []string{"Namespace", "default"},
		},
		{
			Name:          "Invalid Command",
			Cmd:           []string{"invalid-cmd"},
			ExpectSuccess: false,
			ExpectError:   []string{"unknown command"},
			// Note: cobra usually prints unknown command to stderr
		},
		{
			Name:          "Version",
			Cmd:           []string{"version"},
			ExpectSuccess: true,
			ExpectOutput:  []string{"kcli", "commit"},
		},
		// Add more tests here
	}

	for _, tc := range tests { // Use for range for parallel testing if needed, though sequential is safer for state
		t.Run(tc.Name, func(t *testing.T) {
			out, errOut, err := runKCLI(t, tc.Cmd)

			if tc.ExpectSuccess && err != nil {
				t.Fatalf("Expected success but failed: %v\nStderr: %s", err, errOut)
			}
			if !tc.ExpectSuccess && err == nil {
				t.Fatalf("Expected failure but succeeded.\nStdout: %s", out)
			}

			for _, expect := range tc.ExpectOutput {
				if !strings.Contains(out, expect) {
					t.Errorf("Expected output to contain '%s', but got:\n%s", expect, out)
				}
			}

			for _, expectErr := range tc.ExpectError {
				if !strings.Contains(errOut, expectErr) && !strings.Contains(out, expectErr) {
					t.Errorf("Expected error/output to contain '%s', but got stdout:\n%s\nstderr:\n%s", expectErr, out, errOut)
				}
			}
		})
	}
}

func TestKCLINamespaceScoped(t *testing.T) {
	// Requires setup_cluster.sh to have run
	tests := []TestCase{
		{
			Name:          "Get Deployments in kcli-test-1",
			Cmd:           []string{"get", "deploy", "-n", "kcli-test-1"},
			ExpectSuccess: true,
			ExpectOutput:  []string{"nginx-dep"},
		},
		{
			Name:          "Get Services in kcli-test-1",
			Cmd:           []string{"get", "svc", "-n", "kcli-test-1"},
			ExpectSuccess: true,
			ExpectOutput:  []string{"nginx-svc"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.Name, func(t *testing.T) {
			out, errOut, err := runKCLI(t, tc.Cmd)
			if tc.ExpectSuccess && err != nil {
				t.Fatalf("Failed: %v\n%s", err, errOut)
			}
			for _, expect := range tc.ExpectOutput {
				if !strings.Contains(out, expect) {
					t.Errorf("Missing '%s' in output: %s", expect, out)
				}
			}
		})
	}
}
