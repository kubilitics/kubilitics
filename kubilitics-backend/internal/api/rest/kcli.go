package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

const kcliExecTimeout = 90 * time.Second
const confirmDestructiveHeader = "X-Confirm-Destructive"

// PostKCLIExec handles POST /clusters/{clusterId}/kcli/exec
// Body: {"args":["get","pods","-A"],"force":false}
func (h *Handler) PostKCLIExec(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	requestID := logger.FromContext(r.Context())
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	cluster, err := h.clusterService.GetCluster(r.Context(), resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	if cluster.KubeconfigPath == "" {
		respondError(w, http.StatusBadRequest, "Cluster has no kubeconfig path")
		return
	}
	if !h.allowKCLIRate(resolvedID, "exec") {
		respondError(w, http.StatusTooManyRequests, "kcli exec rate limit exceeded")
		return
	}

	var req struct {
		Args  []string `json:"args"`
		Force bool     `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(req.Args) == 0 {
		respondError(w, http.StatusBadRequest, "args are required")
		return
	}
	args, mutating, err := validateKCLIArgs(req.Args, req.Force)
	if err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	if mutating && strings.TrimSpace(r.Header.Get(confirmDestructiveHeader)) == "" {
		respondError(w, http.StatusBadRequest, "mutating kcli commands require X-Confirm-Destructive header")
		return
	}

	kcliBin, err := resolveKCLIBinary()
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	args = append([]string{}, args...)
	if cluster.Context != "" && !hasFlag(args, "--context") {
		args = append([]string{"--context", cluster.Context}, args...)
	}
	if req.Force && !hasFlag(args, "--force") {
		args = append([]string{"--force"}, args...)
	}

	ctx, cancel := context.WithTimeout(r.Context(), kcliExecTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, kcliBin, args...)
	cmd.Env = append(os.Environ(), "KUBECONFIG="+cluster.KubeconfigPath)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	exitCode := 0
	auditCommand := renderAuditCommand(args)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			audit.LogCommand(requestID, resolvedID, "kcli_exec", auditCommand, "failure", "timeout", 124, time.Since(start))
			respondError(w, http.StatusGatewayTimeout, "kcli command timed out")
			return
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			audit.LogCommand(requestID, resolvedID, "kcli_exec", auditCommand, "failure", err.Error(), -1, time.Since(start))
			respondError(w, http.StatusInternalServerError, "Failed to run kcli: "+err.Error())
			return
		}
	}
	outcome := "success"
	msg := ""
	if exitCode != 0 {
		outcome = "failure"
		msg = "non-zero exit"
	}
	audit.LogCommand(requestID, resolvedID, "kcli_exec", auditCommand, outcome, msg, exitCode, time.Since(start))

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"stdout":   stdout.String(),
		"stderr":   stderr.String(),
		"exitCode": exitCode,
	})
}

func resolveKCLIBinary() (string, error) {
	if v := strings.TrimSpace(os.Getenv("KCLI_BIN")); v != "" {
		if st, err := os.Stat(v); err == nil && !st.IsDir() {
			return v, nil
		}
		return "", fmt.Errorf("KCLI_BIN is set but not executable: %s", v)
	}
	if path, err := exec.LookPath("kcli"); err == nil {
		return path, nil
	}
	cwd, err := os.Getwd()
	if err == nil {
		cand := filepath.Clean(filepath.Join(cwd, "..", "kcli", "bin", "kcli"))
		if st, serr := os.Stat(cand); serr == nil && !st.IsDir() {
			return cand, nil
		}
	}
	return "", fmt.Errorf("kcli binary not found. Install kcli in PATH, set KCLI_BIN, or build ../kcli/bin/kcli")
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag || strings.HasPrefix(a, flag+"=") {
			return true
		}
	}
	return false
}
