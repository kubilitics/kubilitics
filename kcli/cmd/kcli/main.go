package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/kubilitics/kcli/internal/cli"
	"github.com/kubilitics/kcli/internal/plugin"
	"github.com/kubilitics/kcli/internal/runner"
)

func main() {
	args := os.Args[1:]
	handled, err := plugin.TryRunForArgs(args, cli.IsBuiltinFirstArg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if handled {
		return
	}
	if shouldFallbackToKubectl(args) {
		kubectlArgs, force, ferr := stripKCLIOnlyFlags(args)
		if ferr != nil {
			fmt.Fprintln(os.Stderr, ferr)
			os.Exit(1)
		}
		if err := runner.RunKubectl(kubectlArgs, runner.ExecOptions{Force: force}); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	root := cli.NewRootCommand()
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func shouldFallbackToKubectl(args []string) bool {
	first := firstCommandToken(args)
	return first != "" && !cli.IsBuiltinFirstArg(first)
}

func firstCommandToken(args []string) string {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "" {
			continue
		}
		switch {
		case a == "--context" || a == "-n" || a == "--namespace" || a == "--kubeconfig" || a == "--ai-timeout" || a == "--completion-timeout":
			i++
			continue
		case strings.HasPrefix(a, "--context="), strings.HasPrefix(a, "--namespace="), strings.HasPrefix(a, "--kubeconfig="), strings.HasPrefix(a, "--ai-timeout="), strings.HasPrefix(a, "--completion-timeout="):
			continue
		case a == "--force":
			continue
		case strings.HasPrefix(a, "-"):
			continue
		default:
			return a
		}
	}
	return ""
}

func stripKCLIOnlyFlags(args []string) ([]string, bool, error) {
	out := make([]string, 0, len(args))
	force := false
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		switch {
		case a == "--force":
			force = true
			continue
		case a == "--ai-timeout" || a == "--completion-timeout":
			if i+1 >= len(args) {
				return nil, false, fmt.Errorf("%s requires a value", a)
			}
			i++
			continue
		case strings.HasPrefix(a, "--ai-timeout="), strings.HasPrefix(a, "--completion-timeout="):
			continue
		default:
			out = append(out, args[i])
		}
	}
	if len(out) == 0 {
		return nil, false, fmt.Errorf("no kubectl command specified")
	}
	return out, force, nil
}
