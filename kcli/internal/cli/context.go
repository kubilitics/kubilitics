package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/kubilitics/kcli/internal/k8sclient"
	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
)

func newContextCmd(a *app) *cobra.Command {
	var onlyFavorites bool
	var pick bool

	ctxCmd := &cobra.Command{
		Use:     "ctx [name|-]",
		Short:   "Get, set, and manage kube contexts",
		GroupID: "workflow",
		Args:    cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			store, err := state.Load()
			if err != nil {
				return err
			}
			if len(args) == 0 {
				if pick {
					return pickContextInteractive(a, store, onlyFavorites, cmd)
				}
				return printContexts(a, store, onlyFavorites)
			}
			target := strings.TrimSpace(args[0])
			if target == "-" {
				if store.LastContext == "" {
					return fmt.Errorf("no previous context recorded")
				}
				target = store.LastContext
			}
			current, _ := currentContext(a)
			if err := a.runKubectl([]string{"config", "use-context", target}); err != nil {
				return err
			}
			store.MarkContextSwitched(current, target)
			if err := state.Save(store); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Switched to context %q\n", target)
			return nil
		},
	}
	ctxCmd.Flags().BoolVarP(&onlyFavorites, "favorites", "f", false, "show favorite contexts only")
	ctxCmd.Flags().BoolVar(&pick, "pick", false, "interactive fuzzy-like context picker")

	favCmd := &cobra.Command{Use: "fav", Short: "Manage favorite contexts"}
	favCmd.AddCommand(
		&cobra.Command{
			Use:   "add <context>",
			Short: "Add context to favorites",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.AddFavorite(strings.TrimSpace(args[0]))
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Added %q to favorites\n", args[0])
				return nil
			},
		},
		&cobra.Command{
			Use:   "rm <context>",
			Short: "Remove context from favorites",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.RemoveFavorite(strings.TrimSpace(args[0]))
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Removed %q from favorites\n", args[0])
				return nil
			},
		},
		&cobra.Command{
			Use:   "ls",
			Short: "List favorite contexts",
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				for _, v := range s.Favorites {
					fmt.Fprintln(cmd.OutOrStdout(), v)
				}
				return nil
			},
		},
	)
	ctxCmd.AddCommand(favCmd)
	ctxCmd.AddCommand(newContextGroupCmd(a))

	ctxCmd.ValidArgsFunction = func(cmd *cobra.Command, args []string, _ string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		ctxs, err := listContexts(a)
		if err != nil {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return ctxs, cobra.ShellCompDirectiveNoFileComp
	}

	return ctxCmd
}

func newContextGroupCmd(a *app) *cobra.Command {
	groupCmd := &cobra.Command{
		Use:   "group [name]",
		Short: "Manage named context groups for multi-cluster workflows",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := state.Load()
			if err != nil {
				return err
			}
			if len(args) == 0 {
				return printContextGroups(cmd, s)
			}
			name := strings.TrimSpace(args[0])
			if name == "" {
				return fmt.Errorf("group name is required")
			}
			if s.ContextGroups == nil {
				s.ContextGroups = map[string][]string{}
			}
			members, ok := s.ContextGroups[name]
			if !ok {
				return fmt.Errorf("context group %q not found", name)
			}
			s.SetActiveContextGroup(name)
			if err := state.Save(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Active group: %s (%d contexts)\n", name, len(members))
			for _, c := range members {
				fmt.Fprintf(cmd.OutOrStdout(), "  - %s\n", c)
			}
			return nil
		},
	}

	groupCmd.AddCommand(
		&cobra.Command{
			Use:   "set <name> <context...>",
			Short: "Create/replace a context group",
			Args:  cobra.MinimumNArgs(2),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				name := strings.TrimSpace(args[0])
				valid, missing, err := validateContextsExist(a, args[1:])
				if err != nil {
					return err
				}
				if len(missing) > 0 {
					return fmt.Errorf("unknown contexts: %s", strings.Join(missing, ", "))
				}
				s.SetContextGroup(name, valid)
				if _, ok := s.ContextGroups[name]; !ok {
					return fmt.Errorf("group name is required")
				}
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Set group %q with %d contexts\n", name, len(s.ContextGroups[name]))
				return nil
			},
		},
		&cobra.Command{
			Use:   "add <name> <context...>",
			Short: "Add contexts to a group",
			Args:  cobra.MinimumNArgs(2),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				name := strings.TrimSpace(args[0])
				valid, missing, err := validateContextsExist(a, args[1:])
				if err != nil {
					return err
				}
				if len(missing) > 0 {
					return fmt.Errorf("unknown contexts: %s", strings.Join(missing, ", "))
				}
				s.AddContextGroupMembers(name, valid)
				if _, ok := s.ContextGroups[name]; !ok {
					return fmt.Errorf("group name is required")
				}
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Group %q now has %d contexts\n", name, len(s.ContextGroups[name]))
				return nil
			},
		},
		&cobra.Command{
			Use:   "rm <name> [context...]",
			Short: "Remove contexts from group or delete group",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				name := strings.TrimSpace(args[0])
				if s.ContextGroups == nil {
					return fmt.Errorf("context group %q not found", name)
				}
				if _, ok := s.ContextGroups[name]; !ok {
					return fmt.Errorf("context group %q not found", name)
				}
				s.RemoveContextGroupMembers(name, args[1:])
				if err := state.Save(s); err != nil {
					return err
				}
				if s.ContextGroups == nil {
					fmt.Fprintf(cmd.OutOrStdout(), "Deleted group %q\n", name)
					return nil
				}
				if members, ok := s.ContextGroups[name]; ok {
					fmt.Fprintf(cmd.OutOrStdout(), "Group %q now has %d contexts\n", name, len(members))
				} else {
					fmt.Fprintf(cmd.OutOrStdout(), "Deleted group %q\n", name)
				}
				return nil
			},
		},
		newContextGroupExportCmd(),
		newContextGroupImportCmd(a),
		&cobra.Command{
			Use:   "ls",
			Short: "List all context groups",
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				return printContextGroups(cmd, s)
			},
		},
	)

	return groupCmd
}

func newContextGroupExportCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "export <path|->",
		Short: "Export context groups as JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := state.Load()
			if err != nil {
				return err
			}
			payload := map[string]interface{}{
				"activeGroup": s.ActiveContextGroup,
				"groups":      s.ContextGroups,
			}
			b, err := json.MarshalIndent(payload, "", "  ")
			if err != nil {
				return err
			}
			target := strings.TrimSpace(args[0])
			if target == "-" {
				fmt.Fprintln(cmd.OutOrStdout(), string(b))
				return nil
			}
			if err := os.WriteFile(target, b, 0o600); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Exported context groups to %s\n", target)
			return nil
		},
	}
}

func newContextGroupImportCmd(a *app) *cobra.Command {
	var merge bool
	var allowMissing bool
	cmd := &cobra.Command{
		Use:   "import <path>",
		Short: "Import context groups from JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			b, err := os.ReadFile(strings.TrimSpace(args[0]))
			if err != nil {
				return err
			}
			active, incoming, err := decodeContextGroupPayload(b)
			if err != nil {
				return err
			}
			knownSet, err := contextSet(a)
			if err != nil {
				return err
			}

			validated := map[string][]string{}
			for name, members := range incoming {
				valid := make([]string, 0, len(members))
				missing := make([]string, 0)
				for _, m := range members {
					m = strings.TrimSpace(m)
					if m == "" {
						continue
					}
					if _, ok := knownSet[m]; ok || allowMissing {
						valid = append(valid, m)
					} else {
						missing = append(missing, m)
					}
				}
				if len(missing) > 0 {
					return fmt.Errorf("group %q has unknown contexts: %s", name, strings.Join(missing, ", "))
				}
				if len(valid) > 0 {
					validated[name] = valid
				}
			}

			s, err := state.Load()
			if err != nil {
				return err
			}
			if !merge || s.ContextGroups == nil {
				s.ContextGroups = map[string][]string{}
			}
			for name, members := range validated {
				if merge {
					s.AddContextGroupMembers(name, members)
				} else {
					s.SetContextGroup(name, members)
				}
			}
			if active != "" {
				s.SetActiveContextGroup(active)
			}
			if err := state.Save(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Imported %d context groups\n", len(validated))
			return nil
		},
	}
	cmd.Flags().BoolVar(&merge, "merge", true, "merge with existing groups (false replaces all groups)")
	cmd.Flags().BoolVar(&allowMissing, "allow-missing", false, "allow contexts not currently in kubeconfig")
	return cmd
}

func validateContextsExist(a *app, contexts []string) (valid []string, missing []string, err error) {
	knownSet, err := contextSet(a)
	if err != nil {
		return nil, nil, err
	}
	seen := map[string]struct{}{}
	for _, c := range contexts {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		if _, ok := knownSet[c]; ok {
			valid = append(valid, c)
		} else {
			missing = append(missing, c)
		}
	}
	return valid, missing, nil
}

func contextSet(a *app) (map[string]struct{}, error) {
	ctxs, err := listContexts(a)
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{}, len(ctxs))
	for _, c := range ctxs {
		out[c] = struct{}{}
	}
	return out, nil
}

func decodeContextGroupPayload(b []byte) (active string, groups map[string][]string, err error) {
	var withMeta struct {
		ActiveGroup string              `json:"activeGroup"`
		Groups      map[string][]string `json:"groups"`
	}
	if err = json.Unmarshal(b, &withMeta); err == nil && withMeta.Groups != nil {
		return strings.TrimSpace(withMeta.ActiveGroup), withMeta.Groups, nil
	}
	var plain map[string][]string
	if err = json.Unmarshal(b, &plain); err == nil && plain != nil {
		return "", plain, nil
	}
	return "", nil, fmt.Errorf("invalid context group payload")
}

func printContextGroups(cmd *cobra.Command, s *state.Store) error {
	if s.ContextGroups == nil || len(s.ContextGroups) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "No context groups configured.")
		return nil
	}
	names := make([]string, 0, len(s.ContextGroups))
	for name := range s.ContextGroups {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		marker := " "
		if name == s.ActiveContextGroup {
			marker = "*"
		}
		members := s.ContextGroups[name]
		fmt.Fprintf(cmd.OutOrStdout(), "%s %s (%d)\n", marker, name, len(members))
	}
	return nil
}

func printContexts(a *app, s *state.Store, onlyFavorites bool) error {
	ctxs, err := listContexts(a)
	if err != nil {
		return err
	}
	current, _ := currentContext(a)
	favorites := make(map[string]struct{}, len(s.Favorites))
	for _, v := range s.Favorites {
		favorites[v] = struct{}{}
	}
	sort.Strings(ctxs)
	for _, c := range ctxs {
		if onlyFavorites {
			if _, ok := favorites[c]; !ok {
				continue
			}
		}
		prefix := "  "
		if c == current {
			prefix = "* "
		}
		fav := ""
		if _, ok := favorites[c]; ok {
			fav = " [fav]"
		}
		fmt.Printf("%s%s%s\n", prefix, c, fav)
	}
	return nil
}

func pickContextInteractive(a *app, s *state.Store, onlyFavorites bool, cmd *cobra.Command) error {
	if !isTerminalSession() {
		return fmt.Errorf("--pick requires an interactive terminal")
	}
	ctxs, err := listContexts(a)
	if err != nil {
		return err
	}
	current, _ := currentContext(a)
	favorites := make(map[string]struct{}, len(s.Favorites))
	for _, v := range s.Favorites {
		favorites[v] = struct{}{}
	}
	sort.Strings(ctxs)
	candidates := make([]string, 0, len(ctxs))
	for _, c := range ctxs {
		if onlyFavorites {
			if _, ok := favorites[c]; !ok {
				continue
			}
		}
		candidates = append(candidates, c)
	}
	if len(candidates) == 0 {
		return fmt.Errorf("no contexts available")
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Fprint(cmd.OutOrStdout(), "Filter context (substring, empty=all): ")
	queryRaw, _ := reader.ReadString('\n')
	query := strings.ToLower(strings.TrimSpace(queryRaw))
	filtered := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if query == "" || strings.Contains(strings.ToLower(c), query) {
			filtered = append(filtered, c)
		}
	}
	if len(filtered) == 0 {
		return fmt.Errorf("no contexts match %q", query)
	}
	if len(filtered) == 1 {
		target := filtered[0]
		if err := a.runKubectl([]string{"config", "use-context", target}); err != nil {
			return err
		}
		s.MarkContextSwitched(current, target)
		if err := state.Save(s); err != nil {
			return err
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Switched to context %q\n", target)
		return nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), "Select context:")
	for i, c := range filtered {
		marker := " "
		if c == current {
			marker = "*"
		}
		fmt.Fprintf(cmd.OutOrStdout(), "  %d) %s %s\n", i+1, marker, c)
	}
	fmt.Fprint(cmd.OutOrStdout(), "Choice [1-", len(filtered), "]: ")
	choiceRaw, _ := reader.ReadString('\n')
	choiceRaw = strings.TrimSpace(choiceRaw)
	n, err := strconv.Atoi(choiceRaw)
	if err != nil || n < 1 || n > len(filtered) {
		return fmt.Errorf("invalid selection %q", choiceRaw)
	}
	target := filtered[n-1]
	if err := a.runKubectl([]string{"config", "use-context", target}); err != nil {
		return err
	}
	s.MarkContextSwitched(current, target)
	if err := state.Save(s); err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Switched to context %q\n", target)
	return nil
}

func isTerminalSession() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func listContexts(a *app) ([]string, error) {
	return k8sclient.ListContexts(a.kubeconfig)
}

func currentContext(a *app) (string, error) {
	if strings.TrimSpace(a.context) != "" {
		return strings.TrimSpace(a.context), nil
	}
	return k8sclient.CurrentContext(a.kubeconfig)
}
