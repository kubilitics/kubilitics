package heartbeat

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

// ErrNeedsReRegister is returned by RunWithCreds when the hub signals that the
// agent must clear its credential Secret and re-register (e.g. 410 uid_mismatch
// or a permanent 401 on refresh).
var ErrNeedsReRegister = errors.New("re-registration required")

type HubAPI interface {
	Heartbeat(ctx context.Context, access string, req hubclient.HeartbeatRequest) (hubclient.HeartbeatResponse, error)
	Refresh(ctx context.Context, refresh string) (hubclient.RefreshResponse, error)
}

type Inputs struct {
	Hub          HubAPI
	Interval     time.Duration
	ClusterID    string
	ClusterUID   string
	AgentVersion string
	K8sVersion   string
}

type Loop struct{ in Inputs }

func New(in Inputs) *Loop { return &Loop{in: in} }

// RunWithCreds blocks until ctx is cancelled, the hub returns 410, or refresh
// returns a permanent failure. Returns ErrNeedsReRegister when the agent must
// clear its credential Secret and re-register; nil when ctx ended cleanly.
func (l *Loop) RunWithCreds(ctx context.Context, refresh, access string) error {
	t := time.NewTicker(l.in.Interval)
	defer t.Stop()
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
		_, err := l.in.Hub.Heartbeat(ctx, access, hubclient.HeartbeatRequest{
			ClusterID: l.in.ClusterID, ClusterUID: l.in.ClusterUID,
			AgentVersion: l.in.AgentVersion, K8sVersion: l.in.K8sVersion,
			Status: "healthy",
		})
		if err == nil {
			backoff = time.Second
			continue
		}
		var apiErr *hubclient.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 && apiErr.Code == "access_expired" {
			rr, rerr := l.in.Hub.Refresh(ctx, refresh)
			if rerr == nil {
				access = rr.AccessToken
				continue
			}
			// If refresh itself fails with a 401, the refresh token is also
			// invalid — treat as permanent failure requiring re-registration.
			var refreshAPIErr *hubclient.APIError
			if errors.As(rerr, &refreshAPIErr) && refreshAPIErr.Status == 401 {
				log.Printf("refresh token rejected (401) — re-registration required")
				return ErrNeedsReRegister
			}
		}
		if errors.As(err, &apiErr) && apiErr.Status == 410 {
			log.Printf("hub returned 410 — re-registration required")
			return ErrNeedsReRegister
		}
		log.Printf("heartbeat error: %v (backoff %s)", err, backoff)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
		if backoff < 60*time.Second {
			backoff *= 2
		}
	}
}
