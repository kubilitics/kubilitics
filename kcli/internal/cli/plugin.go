package cli

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kubilitics/kcli/internal/plugin"
	"github.com/spf13/cobra"
)

func newPluginCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "plugin",
		Short:   "Manage and run kcli plugins",
		GroupID: "workflow",
	}
	cmd.AddCommand(
		&cobra.Command{
			Use:   "list",
			Short: "List installed plugins",
			RunE: func(cmd *cobra.Command, _ []string) error {
				plugins, err := plugin.DiscoverInfo()
				if err != nil {
					return err
				}
				if len(plugins) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No plugins installed.")
					return nil
				}
				for _, p := range plugins {
					status := "ready"
					if p.ValidationError != nil {
						status = "invalid"
					}
					version := "-"
					if p.Manifest != nil {
						version = p.Manifest.Version
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\n", p.Name, version, status)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "search <keyword>",
			Short: "Search installed plugins and marketplace catalog",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				results, err := plugin.SearchInstalled(args[0])
				if err != nil {
					return err
				}
				market, merr := plugin.SearchMarketplace(args[0])
				if merr != nil {
					return merr
				}
				if len(results) == 0 && len(market) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No matching plugins.")
					return nil
				}
				if len(results) > 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "Installed:")
					for _, p := range results {
						desc := "-"
						if p.Manifest != nil && strings.TrimSpace(p.Manifest.Description) != "" {
							desc = p.Manifest.Description
						}
						fmt.Fprintf(cmd.OutOrStdout(), "  %s\t%s\n", p.Name, desc)
					}
				}
				if len(market) > 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "Marketplace:")
					for _, p := range market {
						tag := "community"
						if p.Official {
							tag = "official"
						}
						fmt.Fprintf(cmd.OutOrStdout(), "  %s\t%s\tv%s\t%s\tdl=%d\trating=%.1f\n", p.Name, tag, p.Version, p.Description, p.Downloads, p.Rating)
					}
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "marketplace",
			Short: "List marketplace catalog plugins",
			RunE: func(cmd *cobra.Command, _ []string) error {
				catalog, err := plugin.MarketplaceCatalog()
				if err != nil {
					return err
				}
				for _, p := range catalog {
					tag := "community"
					if p.Official {
						tag = "official"
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\tv%s\tdl=%d\trating=%.1f\n", p.Name, tag, p.Version, p.Downloads, p.Rating)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "inspect <name>",
			Short: "Show plugin manifest and permission policy",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				return printPluginInspect(cmd, strings.TrimSpace(args[0]))
			},
		},
		&cobra.Command{
			Use:     "info <name>",
			Aliases: []string{"show"},
			Short:   "Alias of plugin inspect",
			Args:    cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				return printPluginInspect(cmd, strings.TrimSpace(args[0]))
			},
		},
		&cobra.Command{
			Use:   "install <source>",
			Short: "Install plugin from local path or github.com/<org>/<repo>",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				entry, err := plugin.InstallFromSource(args[0])
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Installed plugin %q from %s (%s)\n", entry.Name, entry.Source, entry.SourceType)
				return nil
			},
		},
		newPluginUpdateCmd(),
		&cobra.Command{
			Use:   "update-all",
			Short: "Update all installed plugins from their recorded sources",
			RunE: func(cmd *cobra.Command, _ []string) error {
				updated, err := plugin.UpdateAllInstalled()
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Updated %d plugin(s)\n", len(updated))
				return nil
			},
		},
		&cobra.Command{
			Use:     "remove <name>",
			Aliases: []string{"uninstall"},
			Short:   "Remove installed plugin binary and manifest",
			Args:    cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				if err := plugin.RemoveInstalled(args[0]); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Removed plugin %q\n", args[0])
				return nil
			},
		},
		&cobra.Command{
			Use:   "allow <name> [permission...]",
			Short: "Approve plugin permissions (all declared permissions when omitted)",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				name := strings.TrimSpace(args[0])
				var permissions []string
				if len(args) > 1 {
					permissions = args[1:]
				} else {
					info, err := plugin.Inspect(name)
					if err != nil {
						return err
					}
					if info.ValidationError != nil {
						return fmt.Errorf("plugin %q has invalid manifest: %w", name, info.ValidationError)
					}
					permissions = info.Manifest.Permissions
				}
				if err := plugin.AllowPermissions(name, permissions); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Approved %d permission(s) for plugin %q\n", len(permissions), name)
				return nil
			},
		},
		&cobra.Command{
			Use:   "revoke <name> [permission...]",
			Short: "Revoke plugin permission approvals (all when omitted)",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				name := strings.TrimSpace(args[0])
				permissions := []string(nil)
				if len(args) > 1 {
					permissions = args[1:]
				}
				if err := plugin.RevokePermissions(name, permissions); err != nil {
					return err
				}
				if len(permissions) == 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "Revoked all permissions for plugin %q\n", name)
				} else {
					fmt.Fprintf(cmd.OutOrStdout(), "Revoked %d permission(s) for plugin %q\n", len(permissions), name)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "run <name> [args...]",
			Short: "Run a plugin by name",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(_ *cobra.Command, args []string) error {
				return plugin.Run(args[0], args[1:])
			},
		},
	)
	return cmd
}

func printPluginInspect(cmd *cobra.Command, name string) error {
	info, err := plugin.Inspect(name)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Name: %s\n", info.Name)
	fmt.Fprintf(cmd.OutOrStdout(), "Path: %s\n", info.Path)
	if info.ValidationError != nil {
		fmt.Fprintf(cmd.OutOrStdout(), "Manifest: invalid (%v)\n", info.ValidationError)
		return nil
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Version: %s\n", info.Manifest.Version)
	if info.Manifest.Author != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "Author: %s\n", info.Manifest.Author)
	}
	if info.Manifest.Description != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "Description: %s\n", info.Manifest.Description)
	}
	if len(info.Manifest.Commands) > 0 {
		fmt.Fprintf(cmd.OutOrStdout(), "Commands: %s\n", strings.Join(info.Manifest.Commands, ", "))
	}
	required := append([]string(nil), info.Manifest.Permissions...)
	sort.Strings(required)
	missing, err := plugin.MissingPermissions(name, required)
	if err != nil {
		return err
	}
	missingSet := map[string]struct{}{}
	for _, p := range missing {
		missingSet[p] = struct{}{}
	}
	if len(required) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "Permissions: none")
		return nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), "Permissions:")
	for _, p := range required {
		status := "approved"
		if _, isMissing := missingSet[p]; isMissing {
			status = "pending-approval"
		}
		fmt.Fprintf(cmd.OutOrStdout(), "  - %s (%s)\n", p, status)
	}
	return nil
}

func newPluginUpdateCmd() *cobra.Command {
	var updateAll bool
	cmd := &cobra.Command{
		Use:   "update [name]",
		Short: "Update one plugin (or all plugins with --all)",
		Args: func(_ *cobra.Command, args []string) error {
			if updateAll {
				if len(args) != 0 {
					return fmt.Errorf("update --all does not take a plugin name")
				}
				return nil
			}
			if len(args) != 1 {
				return fmt.Errorf("update requires exactly one plugin name, or use --all")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			if updateAll {
				updated, err := plugin.UpdateAllInstalled()
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Updated %d plugin(s)\n", len(updated))
				return nil
			}
			entry, err := plugin.UpdateInstalled(args[0])
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Updated plugin %q from %s\n", entry.Name, entry.Source)
			return nil
		},
	}
	cmd.Flags().BoolVar(&updateAll, "all", false, "update all installed plugins")
	return cmd
}
