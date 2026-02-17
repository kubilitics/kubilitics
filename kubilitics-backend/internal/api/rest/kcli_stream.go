package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/audit"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetKCLIStream handles GET /clusters/{clusterId}/kcli/stream.
// mode=query can be: ui (default) or shell.
// Protocol is identical to pod exec/shell stream: stdin, resize, stdout/stderr(base64), exit, error.
func (h *Handler) GetKCLIStream(w http.ResponseWriter, r *http.Request) {
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
	mode := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mode")))
	if mode == "" {
		mode = "ui"
	}
	namespace := strings.TrimSpace(r.URL.Query().Get("namespace"))
	if mode == "shell" && !h.isKCLIShellModeAllowed() {
		respondError(w, http.StatusForbidden, "kcli shell mode is disabled by server policy")
		return
	}
	if !h.allowKCLIRate(resolvedID, "stream") {
		respondError(w, http.StatusTooManyRequests, "kcli stream rate limit exceeded")
		return
	}
	releaseStreamSlot, ok := h.acquireKCLIStreamSlot(resolvedID)
	if !ok {
		respondError(w, http.StatusTooManyRequests, "too many concurrent kcli streams for this cluster")
		return
	}
	defer releaseStreamSlot()

	conn, err := shellStreamUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	log.Printf(
		"kcli stream: connected requestedCluster=%s resolvedCluster=%s context=%s mode=%s",
		clusterID,
		resolvedID,
		cluster.Context,
		mode,
	)
	audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "success", "connected", 0, time.Since(start))

	cmd, err := h.makeKCLIStreamCommand(r.Context(), cluster.Context, cluster.KubeconfigPath, mode, namespace)
	if err != nil {
		audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "failure", err.Error(), -1, time.Since(start))
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: err.Error()})
		return
	}

	ptmx, err := pty.Start(cmd)
	if err != nil {
		audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "failure", err.Error(), -1, time.Since(start))
		_ = conn.WriteJSON(wsOutMessage{T: wsMsgError, D: "failed to start kcli stream: " + err.Error()})
		return
	}
	defer func() {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	outChan := make(chan wsOutMessage, 256)
	execDone := make(chan struct{})
	writerDone := make(chan struct{})
	var once sync.Once
	closeExecDone := func() { once.Do(func() { close(execDone) }) }

	defer func() {
		closeExecDone()
		select {
		case <-execDone:
		case <-time.After(3 * time.Second):
		}
		time.Sleep(execDrainWait)
		close(outChan)
		<-writerDone
	}()

	conn.SetReadLimit(execReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(execPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(execPongWait))
	})

	go func() {
		defer close(writerDone)
		pingTicker := time.NewTicker(execPingPeriod)
		defer pingTicker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-pingTicker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(execWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					cancel()
					return
				}
			case m, ok := <-outChan:
				if !ok {
					return
				}
				b, _ := json.Marshal(m)
				_ = conn.SetWriteDeadline(time.Now().Add(execWriteWait))
				if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	stdoutW := &chanWriter{ch: outChan, typ: wsMsgStdout}
	go func() {
		defer closeExecDone()
		_, _ = io.Copy(stdoutW, ptmx)
	}()

	go func() {
		err := cmd.Wait()
		if err != nil && ctx.Err() == nil {
			audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "failure", err.Error(), -1, time.Since(start))
			select {
			case outChan <- wsOutMessage{T: wsMsgError, D: "kcli stream exited: " + err.Error()}:
			default:
			}
		} else {
			audit.LogCommand(requestID, resolvedID, "kcli_stream", "mode="+mode, "success", "exited", 0, time.Since(start))
		}
		closeExecDone()
		select {
		case outChan <- wsOutMessage{T: wsMsgExit}:
		default:
		}
	}()

	_ = pty.Setsize(ptmx, &pty.Winsize{Cols: execDefaultCols, Rows: execDefaultRows})

	firstStdinLogged := false
	for {
		_ = conn.SetReadDeadline(time.Now().Add(execPongWait))
		_, data, err := conn.ReadMessage()
		if err != nil {
			cancel()
			_ = ptmx.Close()
			select {
			case <-execDone:
			case <-time.After(2 * time.Second):
			}
			return
		}

		var msg wsInMessage
		if json.Unmarshal(data, &msg) != nil {
			continue
		}

		switch msg.T {
		case wsMsgStdin:
			if msg.D != "" {
				if !firstStdinLogged {
					firstStdinLogged = true
					log.Printf(
						"kcli stream: first stdin received requestedCluster=%s resolvedCluster=%s mode=%s",
						clusterID,
						resolvedID,
						mode,
					)
				}
				dec, err := base64.StdEncoding.DecodeString(msg.D)
				if err == nil && len(dec) > 0 {
					_, _ = ptmx.Write(dec)
				}
			}
		case wsMsgResize:
			if msg.R != nil && msg.R.Rows > 0 && msg.R.Cols > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: msg.R.Cols, Rows: msg.R.Rows})
			}
		}
	}
}

func (h *Handler) makeKCLIStreamCommand(ctx context.Context, clusterContext, kubeconfigPath, mode, namespace string) (*exec.Cmd, error) {
	env := append(os.Environ(), "KUBECONFIG="+kubeconfigPath)
	workDir := "/tmp"
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		workDir = home
	}

	switch mode {
	case "ui":
		kcliBin, err := resolveKCLIBinary()
		if err != nil {
			return nil, err
		}
		args := []string{"ui"}
		if clusterContext != "" {
			args = append([]string{"--context", clusterContext}, args...)
		}
		if namespace != "" {
			args = append(args, "--namespace", namespace)
		}
		cmd := exec.CommandContext(ctx, kcliBin, args...)
		cmd.Env = env
		cmd.Dir = workDir
		return cmd, nil
	case "shell":
		sh := "/bin/bash"
		if _, err := exec.LookPath("bash"); err != nil {
			sh = "/bin/sh"
		}
		ctxArg := strings.ReplaceAll(clusterContext, "'", "'\"'\"'")
		var wrapper string
		if sh == "/bin/bash" {
			wrapper = "source <(kubectl completion bash) 2>/dev/null; "
			if clusterContext != "" {
				wrapper += "kubectl config use-context '" + ctxArg + "' 2>/dev/null; "
			}
			wrapper += "exec bash -i"
		} else {
			if clusterContext != "" {
				wrapper = "kubectl config use-context '" + ctxArg + "' 2>/dev/null; "
			}
			wrapper += "exec sh -i"
		}
		cmd := exec.CommandContext(ctx, sh, "-c", wrapper)
		cmd.Env = env
		cmd.Dir = workDir
		return cmd, nil
	default:
		return nil, fmt.Errorf("unsupported mode %q (supported: ui, shell)", mode)
	}
}
