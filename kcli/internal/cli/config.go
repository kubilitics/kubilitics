package cli

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	kcfg "github.com/kubilitics/kcli/internal/config"
	"github.com/spf13/cobra"
)

func newConfigCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "config",
		Short:   "Manage kcli configuration",
		GroupID: "workflow",
	}
	cmd.AddCommand(
		newConfigViewCmd(),
		newConfigGetCmd(),
		newConfigSetCmd(a),
		newConfigResetCmd(a),
		newConfigEditCmd(),
	)
	return cmd
}

func newConfigViewCmd() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "view",
		Short: "Show effective configuration",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			switch strings.ToLower(strings.TrimSpace(output)) {
			case "", "yaml":
				v, err := cfg.ToYAML()
				if err != nil {
					return err
				}
				fmt.Fprint(cmd.OutOrStdout(), v)
				return nil
			case "json":
				v, err := cfg.ToJSON()
				if err != nil {
					return err
				}
				fmt.Fprintln(cmd.OutOrStdout(), v)
				return nil
			default:
				return fmt.Errorf("unsupported --output %q (supported: yaml, json)", output)
			}
		},
	}
	cmd.Flags().StringVar(&output, "output", "yaml", "output format: yaml|json")
	return cmd
}

func newConfigGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <key>",
		Short: "Get a config value by key path",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			v, err := cfg.GetByKey(args[0])
			if err != nil {
				return err
			}
			switch t := v.(type) {
			case []string:
				fmt.Fprintln(cmd.OutOrStdout(), strings.Join(t, ","))
			case bool:
				fmt.Fprintln(cmd.OutOrStdout(), t)
			case int:
				fmt.Fprintln(cmd.OutOrStdout(), t)
			case string:
				fmt.Fprintln(cmd.OutOrStdout(), t)
			default:
				fmt.Fprintln(cmd.OutOrStdout(), v)
			}
			return nil
		},
	}
	return cmd
}

func newConfigSetCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a config value by key path",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			if err := cfg.SetByKey(args[0], args[1]); err != nil {
				return err
			}
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			a.cfg = cfg
			fmt.Fprintf(cmd.OutOrStdout(), "Updated %s\n", args[0])
			return nil
		},
	}
	return cmd
}

func newConfigResetCmd(a *app) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "reset",
		Short: "Reset configuration to defaults",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if !yes {
				return fmt.Errorf("refusing to reset config without --yes")
			}
			cfg := kcfg.Default()
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			a.cfg = cfg
			fmt.Fprintln(cmd.OutOrStdout(), "Configuration reset to defaults")
			return nil
		},
	}
	cmd.Flags().BoolVar(&yes, "yes", false, "confirm reset")
	return cmd
}

func newConfigEditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "edit",
		Short: "Open config file in your editor",
		RunE: func(cmd *cobra.Command, _ []string) error {
			path, err := kcfg.EnsureExists()
			if err != nil {
				return err
			}
			editor := strings.TrimSpace(os.Getenv("VISUAL"))
			if editor == "" {
				editor = strings.TrimSpace(os.Getenv("EDITOR"))
			}
			if editor == "" {
				editor = "vi"
			}
			ep := strings.Fields(editor)
			if len(ep) == 0 {
				return fmt.Errorf("invalid editor command")
			}
			args := append(ep[1:], path)
			proc := exec.Command(ep[0], args...)
			proc.Stdin = cmd.InOrStdin()
			proc.Stdout = cmd.OutOrStdout()
			proc.Stderr = cmd.ErrOrStderr()
			if err := proc.Run(); err != nil {
				return err
			}
			cfg, err := kcfg.Load()
			if err != nil {
				return fmt.Errorf("edited config is invalid: %w", err)
			}
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Configuration validated")
			return nil
		},
	}
	return cmd
}
