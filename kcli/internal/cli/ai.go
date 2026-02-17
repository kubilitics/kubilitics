package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kubilitics/kcli/internal/ai"
	kcfg "github.com/kubilitics/kcli/internal/config"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func newAICmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "ai [question]",
		Short:   "AI-assisted analysis commands (optional)",
		GroupID: "ai",
		Args:    cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return cmd.Help()
			}
			return runAIAction(a, cmd, "query", strings.Join(args, " "))
		},
	}
	cmd.AddCommand(
		newAIActionCmd(a, "explain [resource]", "Explain a Kubernetes resource", "explain"),
		newAIActionCmd(a, "why [resource]", "Explain probable cause behind current state", "why"),
		newAISummarizeCmd(a),
		newAIActionCmd(a, "suggest-fix [resource]", "Suggest remediation for a workload", "suggest-fix"),
		newAIActionCmd(a, "fix [resource]", "Suggest remediation for a workload", "suggest-fix"),
		newAIConfigCmd(a),
		newAIStatusCmd(a),
		newAIUsageCmd(),
		newAICostCmd(a),
	)
	return cmd
}

func newWhyCmd(a *app) *cobra.Command {
	return newAIActionCmd(a, "why [resource]", "AI why-analysis for a resource", "why")
}

func newSummarizeCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{Use: "summarize", Short: "AI summarize commands", GroupID: "ai"}
	cmd.AddCommand(newSummarizeEventsCmd(a))
	return cmd
}

func newSuggestCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{Use: "suggest", Short: "AI suggestion commands", GroupID: "ai"}
	cmd.AddCommand(newAIActionCmd(a, "fix [resource]", "Suggest fix", "suggest-fix"))
	return cmd
}

func newFixCmd(a *app) *cobra.Command {
	return newAIActionCmd(a, "fix [resource]", "AI fix suggestions for a resource", "suggest-fix")
}

func newAISummarizeCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{Use: "summarize", Short: "AI summarize commands"}
	cmd.AddCommand(newSummarizeEventsCmd(a))
	return cmd
}

func newSummarizeEventsCmd(a *app) *cobra.Command {
	var since string
	cmd := &cobra.Command{
		Use:   "events [resource]",
		Short: "Summarize Kubernetes events",
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			target := strings.TrimSpace(strings.Join(args, " "))
			if strings.TrimSpace(since) != "" {
				if target != "" {
					target += " "
				}
				target += "--since=" + strings.TrimSpace(since)
			}
			return runAIAction(a, cmd, "summarize-events", target)
		},
	}
	cmd.Flags().StringVar(&since, "since", "", "event lookback duration hint for AI context (e.g. 6h)")
	return cmd
}

func newAIActionCmd(a *app, use, short, action string) *cobra.Command {
	return &cobra.Command{
		Use:   use,
		Short: short,
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			target := strings.TrimSpace(strings.Join(args, " "))
			return runAIAction(a, cmd, action, target)
		},
	}
}

func newAIConfigCmd(a *app) *cobra.Command {
	var provider string
	var model string
	var key string
	var endpoint string
	var enable bool
	var disable bool
	var budget float64
	var softLimit float64

	cmd := &cobra.Command{
		Use:   "config",
		Short: "View or update AI configuration",
		RunE: func(cmd *cobra.Command, _ []string) error {
			changed := false
			if provider != "" {
				a.cfg.AI.Provider = strings.ToLower(strings.TrimSpace(provider))
				changed = true
			}
			if model != "" {
				a.cfg.AI.Model = strings.TrimSpace(model)
				changed = true
			}
			if key != "" {
				a.cfg.AI.APIKey = strings.TrimSpace(key)
				changed = true
			}
			if endpoint != "" {
				a.cfg.AI.Endpoint = strings.TrimSpace(endpoint)
				changed = true
			}
			if enable && disable {
				return fmt.Errorf("--enable and --disable are mutually exclusive")
			}
			if enable {
				a.cfg.AI.Enabled = true
				changed = true
			}
			if disable {
				a.cfg.AI.Enabled = false
				changed = true
			}
			if cmd.Flags().Changed("budget") {
				a.cfg.AI.BudgetMonthlyUSD = budget
				changed = true
			}
			if cmd.Flags().Changed("soft-limit") {
				a.cfg.AI.SoftLimitPercent = softLimit
				changed = true
			}

			if changed {
				if err := kcfg.Save(a.cfg); err != nil {
					return err
				}
				a.resetAIClient()
				fmt.Fprintln(cmd.OutOrStdout(), "AI config updated")
			}
			printAIConfig(cmd, a.cfg)
			return nil
		},
	}
	cmd.Flags().StringVar(&provider, "provider", "", "provider: openai|anthropic|azure-openai|ollama|custom")
	cmd.Flags().StringVar(&model, "model", "", "default model")
	cmd.Flags().StringVar(&key, "key", "", "API key (stored in ~/.kcli/config.yaml)")
	cmd.Flags().StringVar(&endpoint, "endpoint", "", "provider endpoint override")
	cmd.Flags().BoolVar(&enable, "enable", false, "enable AI")
	cmd.Flags().BoolVar(&disable, "disable", false, "disable AI")
	cmd.Flags().Float64Var(&budget, "budget", a.cfg.AI.BudgetMonthlyUSD, "monthly AI budget in USD")
	cmd.Flags().Float64Var(&softLimit, "soft-limit", a.cfg.AI.SoftLimitPercent, "soft budget warning threshold percent")
	return cmd
}

func newAIStatusCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show AI runtime status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := a.aiClient()
			u, err := ai.LoadMonthlyUsage(time.Now())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Enabled: %v\n", client.Enabled())
			fmt.Fprintf(cmd.OutOrStdout(), "Provider: %s\n", client.ProviderName())
			fmt.Fprintf(cmd.OutOrStdout(), "Model: %s\n", emptyDash(a.cfg.AI.Model))
			fmt.Fprintf(cmd.OutOrStdout(), "Budget: $%.2f/month (soft %.0f%%)\n", a.cfg.AI.BudgetMonthlyUSD, a.cfg.AI.SoftLimitPercent)
			fmt.Fprintf(cmd.OutOrStdout(), "Month: %s\n", u.Month)
			fmt.Fprintf(cmd.OutOrStdout(), "Usage: $%.4f (%d calls, %d cache hits)\n", u.EstimatedCostUSD, u.TotalCalls, u.CacheHits)
			if a.cfg.AI.BudgetMonthlyUSD > 0 {
				pct := (u.EstimatedCostUSD / a.cfg.AI.BudgetMonthlyUSD) * 100
				fmt.Fprintf(cmd.OutOrStdout(), "Budget utilization: %.1f%%\n", pct)
				if pct >= 100 {
					fmt.Fprintln(cmd.OutOrStdout(), "Status: HARD LIMIT REACHED (AI blocked)")
				} else if pct >= a.cfg.AI.SoftLimitPercent {
					fmt.Fprintln(cmd.OutOrStdout(), "Status: SOFT LIMIT REACHED")
				} else {
					fmt.Fprintln(cmd.OutOrStdout(), "Status: OK")
				}
			}
			return nil
		},
	}
}

func newAIUsageCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "usage",
		Short: "Show monthly AI usage statistics",
		RunE: func(cmd *cobra.Command, _ []string) error {
			u, err := ai.LoadMonthlyUsage(time.Now())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Month: %s\n", u.Month)
			fmt.Fprintf(cmd.OutOrStdout(), "Calls: %d\n", u.TotalCalls)
			fmt.Fprintf(cmd.OutOrStdout(), "Cache hits: %d\n", u.CacheHits)
			fmt.Fprintf(cmd.OutOrStdout(), "Prompt tokens: %d\n", u.PromptTokens)
			fmt.Fprintf(cmd.OutOrStdout(), "Completion tokens: %d\n", u.CompletionTokens)
			fmt.Fprintf(cmd.OutOrStdout(), "Estimated cost: $%.4f\n", u.EstimatedCostUSD)
			return nil
		},
	}
}

func newAICostCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "cost",
		Short: "Show monthly AI cost and budget status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			u, err := ai.LoadMonthlyUsage(time.Now())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Month: %s\n", u.Month)
			fmt.Fprintf(cmd.OutOrStdout(), "Cost: $%.4f\n", u.EstimatedCostUSD)
			fmt.Fprintf(cmd.OutOrStdout(), "Budget: $%.2f\n", a.cfg.AI.BudgetMonthlyUSD)
			if a.cfg.AI.BudgetMonthlyUSD <= 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "Budget: disabled")
				return nil
			}
			pct := (u.EstimatedCostUSD / a.cfg.AI.BudgetMonthlyUSD) * 100
			fmt.Fprintf(cmd.OutOrStdout(), "Utilization: %.1f%%\n", pct)
			if pct >= 100 {
				fmt.Fprintln(cmd.OutOrStdout(), "Result: hard limit reached")
			} else if pct >= a.cfg.AI.SoftLimitPercent {
				fmt.Fprintln(cmd.OutOrStdout(), "Result: soft limit reached")
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), "Result: within budget")
			}
			return nil
		},
	}
}

func printAIConfig(cmd *cobra.Command, cfg *kcfg.Config) {
	maskedKey := emptyDash(maskSecret(cfg.AI.APIKey))
	fmt.Fprintf(cmd.OutOrStdout(), "enabled: %v\n", cfg.AI.Enabled)
	fmt.Fprintf(cmd.OutOrStdout(), "provider: %s\n", emptyDash(cfg.AI.Provider))
	fmt.Fprintf(cmd.OutOrStdout(), "model: %s\n", emptyDash(cfg.AI.Model))
	fmt.Fprintf(cmd.OutOrStdout(), "endpoint: %s\n", emptyDash(cfg.AI.Endpoint))
	fmt.Fprintf(cmd.OutOrStdout(), "apiKey: %s\n", maskedKey)
	fmt.Fprintf(cmd.OutOrStdout(), "budgetMonthlyUSD: %.2f\n", cfg.AI.BudgetMonthlyUSD)
	fmt.Fprintf(cmd.OutOrStdout(), "softLimitPercent: %.0f\n", cfg.AI.SoftLimitPercent)
}

func maskSecret(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if len(v) <= 6 {
		return "***"
	}
	return v[:3] + strings.Repeat("*", len(v)-6) + v[len(v)-3:]
}

func runAIAction(a *app, cmd *cobra.Command, action, target string) error {
	client := a.aiClient()
	if !client.Enabled() {
		fmt.Fprintln(cmd.OutOrStdout(), "AI disabled. Set KCLI_AI_PROVIDER (or provider-specific env vars) to enable.")
		return nil
	}

	ctx, cancel := context.WithTimeout(cmd.Context(), a.aiTimeout)
	defer cancel()

	res, err := withSpinner(cmd, "AI", func() (string, error) {
		return client.Analyze(ctx, action, target)
	})
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "AI unavailable (%v). Continuing without AI output.\n", err)
		return nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), res)
	return nil
}

func withSpinner(cmd *cobra.Command, label string, fn func() (string, error)) (string, error) {
	if !isInteractiveErr(cmd) {
		return fn()
	}
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	type result struct {
		v   string
		err error
	}
	out := make(chan result, 1)

	go func() {
		v, err := fn()
		out <- result{v: v, err: err}
	}()

	frames := []string{"-", "\\", "|", "/"}
	idx := 0
	for {
		select {
		case r := <-out:
			fmt.Fprint(cmd.ErrOrStderr(), "\r\033[2K")
			return r.v, r.err
		case <-ticker.C:
			fmt.Fprintf(cmd.ErrOrStderr(), "\r%s %s", frames[idx%len(frames)], label)
			idx++
		}
	}
}

func isInteractiveErr(cmd *cobra.Command) bool {
	f, ok := cmd.ErrOrStderr().(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}
