package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/kubilitics/kcli/internal/runner"
	"github.com/spf13/cobra"
)

func newExecCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "exec (POD | TYPE/NAME) [COMMAND] [flags]",
		Short:              "Execute a command in a container with smart container selection",
		GroupID:            "core",
		DisableFlagParsing: true,
		ValidArgsFunction:  a.completeKubectl("exec"),
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()

			// If no container is specified via -c, try to find the best one
			if !hasContainerFlag(clean) && len(clean) > 0 {
				target := clean[0]
				if !strings.HasPrefix(target, "-") {
					ns, pod, err := a.resolvePod(target)
					if err == nil {
						container, err := a.selectContainer(ns, pod, "exec")
						if err == nil && container != "" {
							clean = insertContainerFlag(clean, container)
						}
					}
				}
			}

			full := append([]string{"exec"}, clean...)
			return a.runKubectl(full)
		},
	}
}

func newPortForwardCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "port-forward (POD | TYPE/NAME) [LOCAL_PORT:]REMOTE_PORT [...-PORT] [flags]",
		Short:              "Forward one or more local ports to a pod",
		GroupID:            "core",
		DisableFlagParsing: true,
		ValidArgsFunction:  a.completeKubectl("port-forward"),
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()

			full := append([]string{"port-forward"}, clean...)
			return a.runKubectl(full)
		},
	}
}

func hasContainerFlag(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "-c" || a == "--container" {
			return true
		}
		if strings.HasPrefix(a, "--container=") {
			return true
		}
	}
	return false
}

func insertContainerFlag(args []string, container string) []string {
	if len(args) == 0 {
		return []string{"-c", container}
	}
	// Insert after the first non-flag argument (the pod name)
	for i := 0; i < len(args); i++ {
		if !strings.HasPrefix(args[i], "-") {
			out := make([]string, 0, len(args)+2)
			out = append(out, args[:i+1]...)
			out = append(out, "-c", container)
			out = append(out, args[i+1:]...)
			return out
		}
	}
	return append([]string{"-c", container}, args...)
}

func (a *app) resolvePod(target string) (string, string, error) {
	// Simple pod resolution: handle ns/pod or just pod
	parts := strings.SplitN(target, "/", 2)
	if len(parts) == 2 {
		return parts[0], parts[1], nil
	}
	ns := a.namespace
	if ns == "" {
		ns = "default"
	}
	return ns, target, nil
}

func (a *app) selectContainer(namespace, pod, _ string) (string, error) {
	// Use captureKubectl to get pod info as JSON
	out, err := a.captureKubectl([]string{"get", "pod", pod, "-n", namespace, "-o", "json"})
	if err != nil {
		return "", err
	}

	var p struct {
		Spec struct {
			Containers []struct {
				Name string `json:"name"`
			} `json:"containers"`
		} `json:"spec"`
	}
	if err := json.Unmarshal([]byte(out), &p); err != nil {
		return "", fmt.Errorf("failed to parse pod JSON: %w", err)
	}

	containers := make([]string, 0, len(p.Spec.Containers))
	for _, c := range p.Spec.Containers {
		containers = append(containers, c.Name)
	}

	if len(containers) <= 1 {
		return "", nil // No need to select if only one or zero
	}

	// If in terminal, prompt. Otherwise pick first.
	if !runner.IsTerminal() {
		return containers[0], nil
	}

	fmt.Fprintf(os.Stderr, "Pod %s has %d containers. Please select one:\n", pod, len(containers))
	for i, c := range containers {
		fmt.Fprintf(os.Stderr, " [%d] %s\n", i+1, c)
	}

	var choice int
	for {
		fmt.Fprintf(os.Stderr, "Select [1-%d]: ", len(containers))
		_, err := fmt.Scanf("%d", &choice)
		if err == nil && choice >= 1 && choice <= len(containers) {
			break
		}
		// Clear stdin buffer if invalid
		var discard string
		fmt.Scanln(&discard)
	}

	return containers[choice-1], nil
}
