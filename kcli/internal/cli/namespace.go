package cli

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
)

func newNamespaceCmd(a *app) *cobra.Command {
	var list bool
	cmd := &cobra.Command{
		Use:     "ns [name]",
		Short:   "Get or set namespace for the current context",
		GroupID: "workflow",
		Args:    cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return printNamespaces(a, cmd, list)
			}
			s, err := state.Load()
			if err != nil {
				return err
			}
			target := strings.TrimSpace(args[0])
			if target == "-" {
				if s.LastNamespace == "" {
					return fmt.Errorf("no previous namespace recorded")
				}
				target = s.LastNamespace
			}
			if target == "" {
				return fmt.Errorf("namespace cannot be empty")
			}
			current, err := currentNamespace(a)
			if err != nil {
				return err
			}
			if err := a.runKubectl([]string{"config", "set-context", "--current", "--namespace", target}); err != nil {
				return err
			}
			s.MarkNamespaceSwitched(current, target)
			if err := state.Save(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Namespace set to %q\n", target)
			return nil
		},
	}
	cmd.Flags().BoolVarP(&list, "list", "l", false, "list namespaces")
	return cmd
}

func printNamespaces(a *app, cmd *cobra.Command, listOnly bool) error {
	out, err := a.captureKubectl([]string{"get", "namespaces", "-o", "name"})
	if err != nil {
		if listOnly {
			return err
		}
		// Fallback to current namespace only when listing namespaces fails.
		out, err = a.captureKubectl([]string{"config", "view", "--minify", "-o", "jsonpath={..namespace}"})
		if err != nil {
			return err
		}
		ns := strings.TrimSpace(out)
		if ns == "" {
			ns = "default"
		}
		fmt.Fprintln(cmd.OutOrStdout(), ns)
		return nil
	}
	current, err := currentNamespace(a)
	if err != nil {
		return err
	}
	if current == "" {
		current = "default"
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	namespaces := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimPrefix(strings.TrimSpace(l), "namespace/")
		if l != "" {
			namespaces = append(namespaces, l)
		}
	}
	sort.Strings(namespaces)
	if len(namespaces) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), current)
		return nil
	}
	for _, ns := range namespaces {
		prefix := "  "
		if ns == current {
			prefix = "* "
		}
		fmt.Fprintf(cmd.OutOrStdout(), "%s%s\n", prefix, ns)
	}
	return nil
}

func currentNamespace(a *app) (string, error) {
	out, err := a.captureKubectl([]string{"config", "view", "--minify", "-o", "jsonpath={..namespace}"})
	if err != nil {
		return "", err
	}
	ns := strings.TrimSpace(out)
	if ns == "" {
		ns = "default"
	}
	return ns, nil
}
