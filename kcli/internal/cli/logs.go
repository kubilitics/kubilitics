package cli

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/spf13/cobra"
)

type podRef struct {
	Namespace string
	Name      string
}

type logsOptions struct {
	Target        string
	Follow        bool
	AllNamespaces bool
	Namespace     string
	Container     string
	Tail          string
	Since         string
	Timestamps    bool
	Grep          string
	GrepV         string
	Save          string
	AISummarize   bool
	AIErrors      bool
	AIExplain     bool
}

type streamWriter struct {
	mu    sync.Mutex
	out   *os.File
	save  *os.File
	color map[string]string
}

var podColors = []string{"\x1b[38;5;39m", "\x1b[38;5;208m", "\x1b[38;5;112m", "\x1b[38;5;177m", "\x1b[38;5;45m", "\x1b[38;5;214m", "\x1b[38;5;141m"}

func newLogsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:                "logs [target] [flags]",
		Short:              "Print logs for pods, selectors, or workloads",
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()

			opts, err := parseLogsOptions(clean, a.namespace)
			if err != nil {
				return err
			}
			if opts.AISummarize || opts.AIErrors || opts.AIExplain {
				return runLogsAI(a, clean, opts)
			}
			if !isMultiPodTarget(opts.Target) && opts.Grep == "" && opts.GrepV == "" && opts.Save == "" {
				return a.runKubectl(append([]string{"logs"}, clean...))
			}
			return runMultiPodLogs(a, opts)
		},
	}
}

func parseLogsOptions(args []string, defaultNamespace string) (logsOptions, error) {
	opts := logsOptions{Namespace: defaultNamespace}
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		switch {
		case a == "":
			continue
		case a == "-f" || a == "--follow":
			opts.Follow = true
		case a == "-A" || a == "--all-namespaces":
			opts.AllNamespaces = true
		case a == "--timestamps":
			opts.Timestamps = true
		case a == "-n" || a == "--namespace":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("%s requires a value", a)
			}
			i++
			opts.Namespace = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--namespace="):
			opts.Namespace = strings.TrimSpace(strings.TrimPrefix(a, "--namespace="))
		case a == "-c" || a == "--container":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("%s requires a value", a)
			}
			i++
			opts.Container = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--container="):
			opts.Container = strings.TrimSpace(strings.TrimPrefix(a, "--container="))
		case a == "--tail":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--tail requires a value")
			}
			i++
			opts.Tail = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--tail="):
			opts.Tail = strings.TrimSpace(strings.TrimPrefix(a, "--tail="))
		case a == "--since":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--since requires a value")
			}
			i++
			opts.Since = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--since="):
			opts.Since = strings.TrimSpace(strings.TrimPrefix(a, "--since="))
		case a == "--grep":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--grep requires a value")
			}
			i++
			opts.Grep = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--grep="):
			opts.Grep = strings.TrimSpace(strings.TrimPrefix(a, "--grep="))
		case a == "--grep-v":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--grep-v requires a value")
			}
			i++
			opts.GrepV = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--grep-v="):
			opts.GrepV = strings.TrimSpace(strings.TrimPrefix(a, "--grep-v="))
		case a == "--save":
			if i+1 >= len(args) {
				return logsOptions{}, fmt.Errorf("--save requires a value")
			}
			i++
			opts.Save = strings.TrimSpace(args[i])
		case strings.HasPrefix(a, "--save="):
			opts.Save = strings.TrimSpace(strings.TrimPrefix(a, "--save="))
		case a == "--ai-summarize":
			opts.AISummarize = true
		case a == "--ai-errors":
			opts.AIErrors = true
		case a == "--ai-explain":
			opts.AIExplain = true
		case !strings.HasPrefix(a, "-") && opts.Target == "":
			opts.Target = a
		}
	}
	if opts.AllNamespaces {
		opts.Namespace = ""
	}
	return opts, nil
}

func isMultiPodTarget(target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	if strings.HasPrefix(target, "deployment/") || strings.HasPrefix(target, "deploy/") {
		return true
	}
	return strings.Contains(target, "=")
}

func runLogsAI(a *app, cleanArgs []string, opts logsOptions) error {
	if opts.Follow {
		return fmt.Errorf("AI log analysis does not support follow mode; remove -f/--follow")
	}
	client := a.aiClient()
	if !client.Enabled() {
		return fmt.Errorf("AI disabled. Configure with `kcli ai config --enable --provider=...`")
	}

	logText, err := collectLogsText(a, cleanArgs, opts)
	if err != nil {
		return err
	}
	logText = lastNLogLines(logText, 1000)
	if strings.TrimSpace(logText) == "" {
		return fmt.Errorf("no logs available for AI analysis")
	}

	if opts.AIErrors {
		errLines := extractErrorLines(logText)
		if len(errLines) == 0 {
			fmt.Fprintln(os.Stdout, "No error-like log lines found.")
		} else {
			fmt.Fprintln(os.Stdout, "=== Extracted Errors ===")
			for _, ln := range errLines {
				fmt.Fprintln(os.Stdout, ln)
			}
			fmt.Fprintln(os.Stdout)
		}
		input := logText
		if len(errLines) > 0 {
			input = strings.Join(errLines, "\n")
		}
		out, err := client.Analyze(context.Background(), "why", "Analyze these Kubernetes log errors and identify root causes:\n"+input)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Error Analysis ===")
		fmt.Fprintln(os.Stdout, out)
	}

	if opts.AISummarize {
		out, err := client.Analyze(context.Background(), "summarize-events", "Summarize these Kubernetes logs and major patterns:\n"+logText)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Log Summary ===")
		fmt.Fprintln(os.Stdout, out)
	}

	if opts.AIExplain {
		out, err := client.Analyze(context.Background(), "explain", "Explain this Kubernetes log stream and what to verify next:\n"+logText)
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, "=== AI Log Explanation ===")
		fmt.Fprintln(os.Stdout, out)
	}
	return nil
}

func collectLogsText(a *app, cleanArgs []string, opts logsOptions) (string, error) {
	stripped := stripAILogFlags(cleanArgs)
	if !isMultiPodTarget(opts.Target) {
		return a.captureKubectl(append([]string{"logs"}, stripped...))
	}
	selector, err := resolveLogSelector(a, opts)
	if err != nil {
		return "", err
	}
	pods, err := listPodsBySelector(a, opts, selector)
	if err != nil {
		return "", err
	}
	if len(pods) == 0 {
		return "", fmt.Errorf("no pods match target %q", opts.Target)
	}
	if len(pods) > 30 {
		pods = pods[:30]
	}
	match, exclude, err := compileLogFilters(opts)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, p := range pods {
		args := []string{"logs", p.Name, "-n", p.Namespace}
		if opts.Container != "" {
			args = append(args, "-c", opts.Container)
		}
		if opts.Tail != "" {
			args = append(args, "--tail", opts.Tail)
		}
		if opts.Since != "" {
			args = append(args, "--since", opts.Since)
		}
		if opts.Timestamps {
			args = append(args, "--timestamps")
		}
		out, err := a.captureKubectl(args)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(out), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if match != nil && !match.MatchString(line) {
				continue
			}
			if exclude != nil && exclude.MatchString(line) {
				continue
			}
			b.WriteString(p.Namespace + "/" + p.Name + " | " + line + "\n")
		}
	}
	return b.String(), nil
}

func stripAILogFlags(args []string) []string {
	out := make([]string, 0, len(args))
	for _, a := range args {
		t := strings.TrimSpace(a)
		if t == "--ai-summarize" || t == "--ai-errors" || t == "--ai-explain" {
			continue
		}
		out = append(out, a)
	}
	return out
}

func extractErrorLines(logText string) []string {
	lines := strings.Split(logText, "\n")
	re := regexp.MustCompile(`(?i)(error|exception|panic|fail(ed|ure)?|crash|timeout|oom|denied|forbidden|refused)`)
	out := make([]string, 0, 200)
	seen := map[string]struct{}{}
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" || !re.MatchString(ln) {
			continue
		}
		if _, ok := seen[ln]; ok {
			continue
		}
		seen[ln] = struct{}{}
		out = append(out, ln)
		if len(out) >= 200 {
			break
		}
	}
	return out
}

func lastNLogLines(logText string, n int) string {
	lines := strings.Split(strings.TrimSpace(logText), "\n")
	if n <= 0 || len(lines) <= n {
		return strings.TrimSpace(logText)
	}
	return strings.Join(lines[len(lines)-n:], "\n")
}

func runMultiPodLogs(a *app, opts logsOptions) error {
	selector, err := resolveLogSelector(a, opts)
	if err != nil {
		return err
	}
	pods, err := listPodsBySelector(a, opts, selector)
	if err != nil {
		return err
	}
	if len(pods) == 0 {
		return fmt.Errorf("no pods match target %q", opts.Target)
	}

	match, exclude, err := compileLogFilters(opts)
	if err != nil {
		return err
	}

	writer, cleanup, err := newStreamWriter(opts.Save)
	if err != nil {
		return err
	}
	defer cleanup()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	active := map[string]context.CancelFunc{}
	var mu sync.Mutex
	startStream := func(p podRef) {
		k := p.Namespace + "/" + p.Name
		mu.Lock()
		if _, ok := active[k]; ok {
			mu.Unlock()
			return
		}
		pctx, pcancel := context.WithCancel(ctx)
		active[k] = pcancel
		mu.Unlock()
		go func() {
			_ = streamPodLogs(pctx, a, opts, p, writer, match, exclude)
			mu.Lock()
			delete(active, k)
			mu.Unlock()
		}()
	}

	for _, p := range pods {
		startStream(p)
	}

	if !opts.Follow {
		for {
			time.Sleep(100 * time.Millisecond)
			mu.Lock()
			left := len(active)
			mu.Unlock()
			if left == 0 {
				return nil
			}
		}
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			mu.Lock()
			for _, stop := range active {
				stop()
			}
			mu.Unlock()
			return nil
		case <-ticker.C:
			newPods, err := listPodsBySelector(a, opts, selector)
			if err != nil {
				continue
			}
			for _, p := range newPods {
				startStream(p)
			}
		}
	}
}

func resolveLogSelector(a *app, opts logsOptions) (string, error) {
	target := strings.TrimSpace(opts.Target)
	if target == "" {
		return "", fmt.Errorf("multi-pod logs requires target (selector or deployment/name)")
	}
	if strings.Contains(target, "=") {
		return target, nil
	}
	if strings.HasPrefix(target, "deployment/") || strings.HasPrefix(target, "deploy/") {
		parts := strings.SplitN(target, "/", 2)
		name := strings.TrimSpace(parts[1])
		if name == "" {
			return "", fmt.Errorf("invalid deployment target %q", target)
		}
		args := []string{"get", "deployment", name, "-o", "go-template={{range $k, $v := .spec.selector.matchLabels}}{{printf \"%s=%s,\" $k $v}}{{end}}"}
		if opts.Namespace != "" {
			args = append(args, "-n", opts.Namespace)
		}
		out, err := a.captureKubectl(args)
		if err != nil {
			return "", err
		}
		sel := strings.Trim(strings.TrimSpace(out), ",")
		if sel == "" {
			return "", fmt.Errorf("deployment %q has no matchLabels selector", name)
		}
		return sel, nil
	}
	return "", fmt.Errorf("unsupported logs target %q; use selector key=value or deployment/name", target)
}

func listPodsBySelector(a *app, opts logsOptions, selector string) ([]podRef, error) {
	args := []string{"get", "pods", "-l", selector, "-o", "jsonpath={range .items[*]}{.metadata.namespace}{\"\\t\"}{.metadata.name}{\"\\n\"}{end}"}
	if opts.AllNamespaces {
		args = append(args, "-A")
	} else if opts.Namespace != "" {
		args = append(args, "-n", opts.Namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	pods := make([]podRef, 0, len(lines))
	seen := map[string]struct{}{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 2 {
			continue
		}
		p := podRef{Namespace: strings.TrimSpace(parts[0]), Name: strings.TrimSpace(parts[1])}
		if p.Namespace == "" || p.Name == "" {
			continue
		}
		k := p.Namespace + "/" + p.Name
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		pods = append(pods, p)
	}
	sort.SliceStable(pods, func(i, j int) bool {
		if pods[i].Namespace == pods[j].Namespace {
			return pods[i].Name < pods[j].Name
		}
		return pods[i].Namespace < pods[j].Namespace
	})
	return pods, nil
}

func compileLogFilters(opts logsOptions) (*regexp.Regexp, *regexp.Regexp, error) {
	var match *regexp.Regexp
	var exclude *regexp.Regexp
	var err error
	if strings.TrimSpace(opts.Grep) != "" {
		match, err = regexp.Compile(opts.Grep)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid --grep regex: %w", err)
		}
	}
	if strings.TrimSpace(opts.GrepV) != "" {
		exclude, err = regexp.Compile(opts.GrepV)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid --grep-v regex: %w", err)
		}
	}
	return match, exclude, nil
}

func streamPodLogs(ctx context.Context, a *app, opts logsOptions, pod podRef, w *streamWriter, match, exclude *regexp.Regexp) error {
	args := []string{}
	if a.kubeconfig != "" {
		args = append(args, "--kubeconfig", a.kubeconfig)
	}
	if a.context != "" {
		args = append(args, "--context", a.context)
	}
	args = append(args, "logs")
	if opts.Follow {
		args = append(args, "-f")
	}
	args = append(args, pod.Name, "-n", pod.Namespace)
	if opts.Container != "" {
		args = append(args, "-c", opts.Container)
	}
	if opts.Tail != "" {
		args = append(args, "--tail", opts.Tail)
	}
	if opts.Since != "" {
		args = append(args, "--since", opts.Since)
	}
	if opts.Timestamps {
		args = append(args, "--timestamps")
	}

	cmd := exec.CommandContext(ctx, "kubectl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	var wg sync.WaitGroup
	consume := func(r io.Reader) {
		defer wg.Done()
		s := bufio.NewScanner(r)
		for s.Scan() {
			line := s.Text()
			if match != nil && !match.MatchString(line) {
				continue
			}
			if exclude != nil && exclude.MatchString(line) {
				continue
			}
			w.write(pod.Namespace+"/"+pod.Name, line)
		}
	}
	wg.Add(2)
	go consume(stdout)
	go consume(stderr)
	wg.Wait()
	return cmd.Wait()
}

func newStreamWriter(savePath string) (*streamWriter, func(), error) {
	sw := &streamWriter{out: os.Stdout, color: map[string]string{}}
	cleanup := func() {}
	if strings.TrimSpace(savePath) != "" {
		f, err := os.OpenFile(savePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return nil, nil, err
		}
		sw.save = f
		cleanup = func() {
			_ = f.Close()
		}
	}
	return sw, cleanup, nil
}

func (w *streamWriter) write(source, line string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, ok := w.color[source]; !ok {
		w.color[source] = podColors[len(w.color)%len(podColors)]
	}
	color := w.color[source]
	formatted := fmt.Sprintf("%s%s\x1b[0m | %s", color, source, line)
	fmt.Fprintln(w.out, formatted)
	if w.save != nil {
		fmt.Fprintln(w.save, source+" | "+line)
	}
}
