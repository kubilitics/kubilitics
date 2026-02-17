package cli

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

type k8sPodList struct {
	Items []k8sPod `json:"items"`
}

type k8sPod struct {
	Metadata struct {
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
	} `json:"metadata"`
	Spec struct {
		NodeName string `json:"nodeName"`
	} `json:"spec"`
	Status struct {
		Phase             string `json:"phase"`
		StartTime         string `json:"startTime"`
		ContainerStatuses []struct {
			Name         string `json:"name"`
			RestartCount int    `json:"restartCount"`
			State        struct {
				Waiting struct {
					Reason string `json:"reason"`
				} `json:"waiting"`
				Terminated struct {
					Reason string `json:"reason"`
				} `json:"terminated"`
			} `json:"state"`
			LastState struct {
				Terminated struct {
					Reason     string `json:"reason"`
					FinishedAt string `json:"finishedAt"`
				} `json:"terminated"`
			} `json:"lastState"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

type k8sNodeList struct {
	Items []k8sNode `json:"items"`
}

type k8sNode struct {
	Metadata struct {
		Name string `json:"name"`
	} `json:"metadata"`
	Status struct {
		Conditions []struct {
			Type    string `json:"type"`
			Status  string `json:"status"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"conditions"`
	} `json:"status"`
}

type incidentReport struct {
	CrashLoopBackOff []incidentPodEntry  `json:"crashLoopBackOff"`
	OOMKilled        []incidentPodEntry  `json:"oomKilled"`
	HighRestarts     []incidentPodEntry  `json:"highRestarts"`
	NodePressure     []incidentNodeEntry `json:"nodePressure"`
	CriticalEvents   []eventRecord       `json:"criticalEvents"`
}

type incidentPodEntry struct {
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container,omitempty"`
	Restarts  int    `json:"restarts"`
	Phase     string `json:"phase,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type incidentNodeEntry struct {
	Node      string `json:"node"`
	Condition string `json:"condition"`
	Reason    string `json:"reason,omitempty"`
	Message   string `json:"message,omitempty"`
}

func newIncidentCmd(a *app) *cobra.Command {
	var recent string
	var output string
	var restartThreshold int
	var watch bool
	var interval time.Duration

	cmd := &cobra.Command{
		Use:     "incident",
		Short:   "Incident mode summary (CrashLoop/OOM/restarts/node pressure/events)",
		GroupID: "incident",
		RunE: func(cmd *cobra.Command, _ []string) error {
			render := func() error {
				window := 2 * time.Hour
				if strings.TrimSpace(recent) != "" {
					d, err := time.ParseDuration(strings.TrimSpace(recent))
					if err != nil {
						return fmt.Errorf("invalid --recent value %q: %w", recent, err)
					}
					window = d
				}

				report, err := buildIncidentReport(a, window, restartThreshold)
				if err != nil {
					return err
				}

				switch strings.ToLower(strings.TrimSpace(output)) {
				case "table", "":
					printIncidentTable(cmd, report)
					fmt.Fprintln(cmd.OutOrStdout(), "\nQuick actions:")
					fmt.Fprintln(cmd.OutOrStdout(), "  kcli incident logs <namespace>/<pod> --tail=200")
					fmt.Fprintln(cmd.OutOrStdout(), "  kcli incident describe <namespace>/<pod>")
					fmt.Fprintln(cmd.OutOrStdout(), "  kcli incident restart <namespace>/<pod>")
					return nil
				case "json":
					b, err := json.MarshalIndent(report, "", "  ")
					if err != nil {
						return err
					}
					fmt.Fprintln(cmd.OutOrStdout(), string(b))
					return nil
				default:
					return fmt.Errorf("unsupported --output %q (supported: table, json)", output)
				}
			}
			if !watch {
				return render()
			}
			if interval <= 0 {
				interval = 5 * time.Second
			}
			for {
				fmt.Fprint(cmd.OutOrStdout(), "\033[2J\033[H")
				fmt.Fprintf(cmd.OutOrStdout(), "🚨 Incident Mode (auto-refresh every %s, Ctrl+C to stop)\n\n", interval)
				if err := render(); err != nil {
					return err
				}
				select {
				case <-time.After(interval):
				case <-cmd.Context().Done():
					return nil
				}
			}
		},
	}
	cmd.Flags().StringVar(&recent, "recent", "2h", "duration window for critical events (e.g. 30m, 2h)")
	cmd.Flags().StringVar(&output, "output", "table", "output format: table|json")
	cmd.Flags().IntVar(&restartThreshold, "restarts-threshold", 5, "minimum restarts to classify as high-restart pod")
	cmd.Flags().BoolVar(&watch, "watch", false, "auto-refresh incident summary continuously")
	cmd.Flags().DurationVar(&interval, "refresh", 5*time.Second, "refresh interval for --watch mode")
	cmd.AddCommand(newIncidentQuickActionCmd(a).Commands()...)
	return cmd
}

func newIncidentQuickActionCmd(a *app) *cobra.Command {
	root := &cobra.Command{
		Use:    "actions",
		Short:  "Incident quick actions",
		Hidden: true,
	}

	var tail int
	logs := &cobra.Command{
		Use:   "logs <namespace>/<pod>",
		Short: "Quick action: fetch pod logs",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, err := parseNamespacedPod(args[0])
			if err != nil {
				return err
			}
			return a.runKubectl([]string{"logs", pod, "-n", ns, fmt.Sprintf("--tail=%d", tail)})
		},
	}
	logs.Flags().IntVar(&tail, "tail", 200, "number of log lines to fetch")

	describe := &cobra.Command{
		Use:   "describe <namespace>/<pod>",
		Short: "Quick action: describe pod",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, err := parseNamespacedPod(args[0])
			if err != nil {
				return err
			}
			return a.runKubectl([]string{"describe", "pod", pod, "-n", ns})
		},
	}

	restart := &cobra.Command{
		Use:   "restart <namespace>/<pod>",
		Short: "Quick action: restart pod by deleting it (controller-managed pods)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, err := parseNamespacedPod(args[0])
			if err != nil {
				return err
			}
			return a.runKubectl([]string{"delete", "pod", pod, "-n", ns})
		},
	}

	root.AddCommand(logs, describe, restart)
	return root
}

func parseNamespacedPod(v string) (namespace, pod string, err error) {
	parts := strings.SplitN(strings.TrimSpace(v), "/", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", fmt.Errorf("expected namespace/pod format, got %q", v)
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), nil
}

func buildIncidentReport(a *app, recentWindow time.Duration, restartThreshold int) (*incidentReport, error) {
	pods, err := fetchPods(a)
	if err != nil {
		return nil, err
	}
	nodes, err := fetchNodes(a)
	if err != nil {
		return nil, err
	}
	events, err := fetchEvents(a)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	recentEvents := filterEventsByRecent(events, recentWindow, now)
	criticalEvents := make([]eventRecord, 0, len(recentEvents))
	for _, e := range recentEvents {
		if strings.EqualFold(e.Type, "Warning") {
			criticalEvents = append(criticalEvents, e)
		}
	}
	sort.SliceStable(criticalEvents, func(i, j int) bool {
		return criticalEvents[i].Timestamp.After(criticalEvents[j].Timestamp)
	})
	if len(criticalEvents) > 30 {
		criticalEvents = criticalEvents[:30]
	}

	report := &incidentReport{
		CrashLoopBackOff: make([]incidentPodEntry, 0),
		OOMKilled:        make([]incidentPodEntry, 0),
		HighRestarts:     make([]incidentPodEntry, 0),
		NodePressure:     make([]incidentNodeEntry, 0),
		CriticalEvents:   criticalEvents,
	}

	for _, p := range pods.Items {
		totalRestarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			totalRestarts += cs.RestartCount
			if strings.EqualFold(cs.State.Waiting.Reason, "CrashLoopBackOff") {
				report.CrashLoopBackOff = append(report.CrashLoopBackOff, incidentPodEntry{
					Namespace: p.Metadata.Namespace,
					Pod:       p.Metadata.Name,
					Container: cs.Name,
					Restarts:  cs.RestartCount,
					Phase:     p.Status.Phase,
					Reason:    cs.State.Waiting.Reason,
				})
			}
			if strings.EqualFold(cs.State.Terminated.Reason, "OOMKilled") || strings.EqualFold(cs.LastState.Terminated.Reason, "OOMKilled") {
				report.OOMKilled = append(report.OOMKilled, incidentPodEntry{
					Namespace: p.Metadata.Namespace,
					Pod:       p.Metadata.Name,
					Container: cs.Name,
					Restarts:  cs.RestartCount,
					Phase:     p.Status.Phase,
					Reason:    "OOMKilled",
				})
			}
		}
		if totalRestarts >= restartThreshold {
			report.HighRestarts = append(report.HighRestarts, incidentPodEntry{
				Namespace: p.Metadata.Namespace,
				Pod:       p.Metadata.Name,
				Restarts:  totalRestarts,
				Phase:     p.Status.Phase,
			})
		}
	}

	sort.SliceStable(report.HighRestarts, func(i, j int) bool {
		return report.HighRestarts[i].Restarts > report.HighRestarts[j].Restarts
	})
	if len(report.HighRestarts) > 30 {
		report.HighRestarts = report.HighRestarts[:30]
	}

	for _, n := range nodes.Items {
		for _, c := range n.Status.Conditions {
			if (c.Type == "MemoryPressure" || c.Type == "DiskPressure" || c.Type == "PIDPressure") && strings.EqualFold(c.Status, "True") {
				report.NodePressure = append(report.NodePressure, incidentNodeEntry{
					Node:      n.Metadata.Name,
					Condition: c.Type,
					Reason:    c.Reason,
					Message:   c.Message,
				})
			}
		}
	}

	return report, nil
}

func fetchPods(a *app) (*k8sPodList, error) {
	out, err := a.captureKubectl([]string{"get", "pods", "-A", "-o", "json"})
	if err != nil {
		return nil, err
	}
	var pods k8sPodList
	if err := json.Unmarshal([]byte(out), &pods); err != nil {
		return nil, fmt.Errorf("failed to parse pods JSON: %w", err)
	}
	return &pods, nil
}

func fetchNodes(a *app) (*k8sNodeList, error) {
	out, err := a.captureKubectl([]string{"get", "nodes", "-o", "json"})
	if err != nil {
		return nil, err
	}
	var nodes k8sNodeList
	if err := json.Unmarshal([]byte(out), &nodes); err != nil {
		return nil, fmt.Errorf("failed to parse nodes JSON: %w", err)
	}
	return &nodes, nil
}

func printIncidentTable(cmd *cobra.Command, report *incidentReport) {
	fmt.Fprintln(cmd.OutOrStdout(), "=== CrashLoopBackOff ===")
	if len(report.CrashLoopBackOff) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.CrashLoopBackOff {
			fmt.Fprintf(cmd.OutOrStdout(), "%s/%s container=%s restarts=%d\n", v.Namespace, v.Pod, v.Container, v.Restarts)
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== OOMKilled ===")
	if len(report.OOMKilled) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.OOMKilled {
			fmt.Fprintf(cmd.OutOrStdout(), "%s/%s container=%s restarts=%d\n", v.Namespace, v.Pod, v.Container, v.Restarts)
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== High Restart Pods ===")
	if len(report.HighRestarts) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.HighRestarts {
			fmt.Fprintf(cmd.OutOrStdout(), "%s/%s restarts=%d phase=%s\n", v.Namespace, v.Pod, v.Restarts, emptyDash(v.Phase))
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== Node Pressure ===")
	if len(report.NodePressure) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "None")
	} else {
		for _, v := range report.NodePressure {
			fmt.Fprintf(cmd.OutOrStdout(), "%s condition=%s reason=%s\n", v.Node, v.Condition, emptyDash(v.Reason))
		}
	}

	fmt.Fprintln(cmd.OutOrStdout(), "\n=== Recent Critical Events ===")
	printEventTable(cmd, report.CriticalEvents)
}
