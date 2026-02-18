package runner

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// MinKubectlMajor and MinKubectlMinor define the minimum recommended kubectl client version.
// Older versions may trigger a warning (no hard failure).
const MinKubectlMajor = 1
const MinKubectlMinor = 28

type ExecOptions struct {
	Force  bool
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
}

var mutatingVerbs = map[string]struct{}{
	"apply": {}, "delete": {}, "edit": {}, "patch": {}, "replace": {},
	"create": {}, "run": {}, "drain": {}, "taint": {}, "set": {}, "expose": {},
	"rollout": {}, "scale": {}, "autoscale": {}, "label": {}, "annotate": {},
}

func RunKubectl(args []string, opts ExecOptions) error {
	if len(args) == 0 {
		return fmt.Errorf("no kubectl command provided")
	}
	if shouldConfirm(args, opts.Force) {
		ok, err := askForConfirmation(args)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("aborted")
		}
	}
	cmd := exec.Command("kubectl", args...)
	stdin := opts.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}
	stdout := opts.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}
	cmd.Stdin = stdin
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}

func CaptureKubectl(args []string) (string, error) {
	cmd := exec.Command("kubectl", args...)
	b, err := cmd.CombinedOutput()
	return string(b), err
}

// KubectlVersionClient returns the client version (major, minor) from kubectl version --client -o json.
// Returns 0,0 and nil error if parsing fails (caller can ignore).
func KubectlVersionClient() (major, minor int, err error) {
	out, err := CaptureKubectl([]string{"version", "--client", "--output=json"})
	if err != nil {
		return 0, 0, err
	}
	var v struct {
		ClientVersion struct {
			Major string `json:"major"`
			Minor string `json:"minor"`
		} `json:"clientVersion"`
	}
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		return 0, 0, err
	}
	major, _ = strconv.Atoi(strings.TrimSpace(v.ClientVersion.Major))
	minor, _ = strconv.Atoi(strings.TrimPrefix(strings.TrimSpace(v.ClientVersion.Minor), "+"))
	return major, minor, nil
}

// WarnKubectlVersionSkew checks the current kubectl client version against MinKubectlMajor/MinKubectlMinor
// and writes a warning to w if the version is older. No-op if check fails (e.g. kubectl not in PATH).
func WarnKubectlVersionSkew(w io.Writer) {
	if w == nil {
		return
	}
	major, minor, err := KubectlVersionClient()
	if err != nil {
		return
	}
	if major > MinKubectlMajor {
		return
	}
	if major == MinKubectlMajor && minor >= MinKubectlMinor {
		return
	}
	fmt.Fprintf(w, "kcli: warning: kubectl client version %d.%d is older than recommended %d.%d; some features may not work\n", major, minor, MinKubectlMajor, MinKubectlMinor)
}

func CaptureKubectlWithTimeout(args []string, timeout time.Duration) (string, error) {
	if timeout <= 0 {
		return CaptureKubectl(args)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	b, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return string(b), fmt.Errorf("kubectl timed out after %s", timeout)
	}
	return string(b), err
}

func shouldConfirm(args []string, force bool) bool {
	if force || len(args) == 0 {
		return false
	}
	words := commandWords(args)
	if len(words) == 0 {
		return false
	}
	verb := strings.ToLower(strings.TrimSpace(words[0]))
	if verb == "rollout" && len(words) > 1 {
		sub := strings.ToLower(strings.TrimSpace(words[1]))
		if sub == "status" || sub == "history" {
			return false
		}
	}
	_, ok := mutatingVerbs[verb]
	return ok
}

func commandWords(args []string) []string {
	words := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		tok := strings.TrimSpace(args[i])
		if tok == "" {
			continue
		}
		if tok == "--context" || tok == "--namespace" || tok == "-n" || tok == "--kubeconfig" {
			i++
			continue
		}
		if strings.HasPrefix(tok, "--context=") || strings.HasPrefix(tok, "--namespace=") || strings.HasPrefix(tok, "--kubeconfig=") {
			continue
		}
		if strings.HasPrefix(tok, "-") {
			continue
		}
		words = append(words, tok)
	}
	return words
}

func firstVerb(args []string) string {
	words := commandWords(args)
	if len(words) == 0 {
		return ""
	}
	return words[0]
}

func askForConfirmation(args []string) (bool, error) {
	if !IsTerminal() {
		return false, fmt.Errorf("refusing mutating command in non-interactive mode without --force")
	}
	fmt.Fprintf(os.Stderr, "This command may mutate cluster state:\n  kubectl %s\n", strings.Join(args, " "))
	fmt.Fprint(os.Stderr, "Proceed? [y/N]: ")
	r := bufio.NewReader(os.Stdin)
	line, err := r.ReadString('\n')
	if err != nil {
		if err == io.EOF {
			return false, fmt.Errorf("confirmation required in non-interactive mode; rerun with --force")
		}
		return false, err
	}
	ans := strings.ToLower(strings.TrimSpace(line))
	return ans == "y" || ans == "yes", nil
}

func IsTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
