package ai

import (
	"fmt"
	"regexp"
	"strings"
)

const SystemPrompt = "You are a principal Kubernetes SRE assistant. Give precise, production-safe guidance. Prioritize risk, root cause, verification commands, and rollback options. Never expose secrets."

type PromptRequest struct {
	Action  string
	Target  string
	Query   string
	Events  []Event
	Cluster *ClusterContext
}

type PromptResult struct {
	System          string
	User            string
	EstimatedTokens int
}

func BuildPrompt(req PromptRequest) PromptResult {
	action := strings.ToLower(strings.TrimSpace(req.Action))
	target := sanitizeSensitive(req.Target)
	question := sanitizeSensitive(req.Query)
	ctx := sanitizeSensitive(buildContext(target, req.Cluster))

	var user string
	switch action {
	case "explain":
		user = explainPrompt(target, ctx)
	case "why":
		user = whyPrompt(target, ctx)
	case "suggest-fix", "fix", "suggest":
		user = fixPrompt(target, ctx)
	case "summarize-events", "summarize", "summarize events":
		user = summarizeEventsPrompt(req.Events, ctx)
	case "query":
		user = queryPrompt(question, ctx)
	default:
		if question != "" {
			user = queryPrompt(question, ctx)
		} else {
			user = explainPrompt(target, ctx)
		}
	}

	estimate := estimateTokens(SystemPrompt + "\n" + user)
	return PromptResult{System: SystemPrompt, User: user, EstimatedTokens: estimate}
}

func explainPrompt(target, ctx string) string {
	if strings.TrimSpace(target) == "" {
		target = "current Kubernetes resource"
	}
	return fmt.Sprintf("Explain this Kubernetes target with intent, key fields, operational impact, and safe checks to run next.\\nTarget: %s\\nContext:\\n%s", target, ctx)
}

func whyPrompt(target, ctx string) string {
	if strings.TrimSpace(target) == "" {
		target = "current Kubernetes object"
	}
	return fmt.Sprintf("Perform failure analysis for this Kubernetes target. Provide probable root causes ranked by likelihood, evidence to gather, and commands to confirm each hypothesis.\\nTarget: %s\\nContext:\\n%s", target, ctx)
}

func fixPrompt(target, ctx string) string {
	if strings.TrimSpace(target) == "" {
		target = "affected Kubernetes workload"
	}
	return fmt.Sprintf("Suggest concrete fixes for this Kubernetes issue. Include low-risk immediate mitigation, durable remediation, and rollback strategy. Provide exact kubectl commands.\\nTarget: %s\\nContext:\\n%s", target, ctx)
}

func summarizeEventsPrompt(events []Event, ctx string) string {
	if len(events) == 0 {
		return fmt.Sprintf("Summarize recent Kubernetes events. Focus on warnings/errors, affected resources, and immediate action items.\\nContext:\\n%s", ctx)
	}
	lines := make([]string, 0, len(events))
	for _, e := range events {
		line := strings.TrimSpace(fmt.Sprintf("%s %s %s", sanitizeSensitive(e.Type), sanitizeSensitive(e.Reason), sanitizeSensitive(e.Message)))
		if line != "" {
			lines = append(lines, line)
		}
	}
	return fmt.Sprintf("Summarize these Kubernetes events by severity and suggest next steps.\\nEvents:\\n%s\\nContext:\\n%s", strings.Join(lines, "\\n"), ctx)
}

func queryPrompt(question, ctx string) string {
	if strings.TrimSpace(question) == "" {
		question = "What are the top Kubernetes reliability checks I should run now?"
	}
	return fmt.Sprintf("Answer this Kubernetes operations query with concise, actionable guidance.\\nQuestion: %s\\nContext:\\n%s", question, ctx)
}

func buildContext(target string, cluster *ClusterContext) string {
	parts := []string{}
	if cluster != nil {
		if strings.TrimSpace(cluster.Context) != "" {
			parts = append(parts, "kubeContext="+strings.TrimSpace(cluster.Context))
		}
		if strings.TrimSpace(cluster.Namespace) != "" {
			parts = append(parts, "namespace="+strings.TrimSpace(cluster.Namespace))
		}
		if strings.TrimSpace(cluster.Snapshot) != "" {
			parts = append(parts, "snapshot="+strings.TrimSpace(cluster.Snapshot))
		}
	}
	if strings.TrimSpace(target) != "" {
		parts = append(parts, "target="+strings.TrimSpace(target))
		if ns, kind, name, ok := parseTarget(target); ok {
			parts = append(parts, "parsed.namespace="+ns)
			parts = append(parts, "parsed.kind="+kind)
			parts = append(parts, "parsed.name="+name)
		}
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, "\n")
}

func parseTarget(target string) (namespace, kind, name string, ok bool) {
	t := strings.TrimSpace(target)
	if t == "" {
		return "", "", "", false
	}
	parts := strings.Split(t, "/")
	if len(parts) == 2 {
		return "", strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), strings.TrimSpace(parts[0]) != "" && strings.TrimSpace(parts[1]) != ""
	}
	if len(parts) >= 3 {
		ns := strings.TrimSpace(parts[0])
		kind := strings.TrimSpace(parts[1])
		name := strings.TrimSpace(parts[2])
		if ns == "" || kind == "" || name == "" {
			return "", "", "", false
		}
		return ns, kind, name, true
	}
	return "", "", "", false
}

var sensitivePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+`),
	regexp.MustCompile(`(?s)-----BEGIN [^-]+-----.*?-----END [^-]+-----`),
}

func sanitizeSensitive(v string) string {
	out := strings.TrimSpace(v)
	for _, re := range sensitivePatterns {
		out = re.ReplaceAllStringFunc(out, func(_ string) string { return "[REDACTED]" })
	}
	return out
}

func estimateTokens(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	wordBased := (len(strings.Fields(text))*4 + 2) / 3
	charBased := len(text) / 4
	if wordBased > charBased {
		return wordBased
	}
	return charBased
}
