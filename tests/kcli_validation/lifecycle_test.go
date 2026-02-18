package test

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
	"testing"
)

func TestKCLILifecycle(t *testing.T) {
	// Create a pod, check it, delete it
	resName := "lifecycle-pod"
	ns := "kcli-test-3"

	// 1. Create
	t.Run("Create Pod", func(t *testing.T) {
		yaml := fmt.Sprintf(`
apiVersion: v1
kind: Pod
metadata:
  name: %s
  namespace: %s
spec:
  containers:
  - name: nginx
    image: nginx:alpine
`, resName, ns)
		cmd := exec.Command(kcliPath, "apply", "--force", "-f", "-")
		cmd.Stdin = strings.NewReader(yaml)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			t.Fatalf("Failed to create pod: %v, stderr: %s", err, stderr.String())
		}
	})

	// 2. Get
	t.Run("Get Pod", func(t *testing.T) {
		out, _, err := runKCLI(t, []string{"get", "pod", resName, "-n", ns})
		if err != nil {
			t.Fatalf("Failed to get pod: %v", err)
		}
		if !strings.Contains(out, resName) {
			t.Errorf("Output did not contain pod name '%s', got: %s", resName, out)
		}
	})

	// 3. Describe
	t.Run("Describe Pod", func(t *testing.T) {
		out, _, err := runKCLI(t, []string{"describe", "pod", resName, "-n", ns})
		if err != nil {
			t.Fatalf("Failed to describe: %v", err)
		}
		if !strings.Contains(out, "Image:") && !strings.Contains(out, "Name:") {
			t.Errorf("Describe output missing expected fields (Image or Name)")
		}
	})

	// 4. Delete
	t.Run("Delete Pod", func(t *testing.T) {
		_, _, err := runKCLI(t, []string{"delete", "pod", resName, "-n", ns, "--force"})
		if err != nil {
			t.Fatalf("Failed to delete pod: %v", err)
		}
	})
}
