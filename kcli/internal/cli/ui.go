package cli

import (
	"github.com/kubilitics/kcli/internal/ui"
	"github.com/spf13/cobra"
)

func newUICmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "ui",
		Short:   "Launch interactive Kubernetes TUI",
		GroupID: "workflow",
		RunE: func(_ *cobra.Command, _ []string) error {
			return ui.Run(a.uiOptions())
		},
	}
}
