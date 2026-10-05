package rest

// Phase 2 (docs/TOPOLOGY-SCALE-INVESTIGATION.md): GetTopology (V1,
// `/clusters/{id}/topology`) used to default maxNodes to 0 ("no limit"),
// unlike GetTopologyV2 which has always hard-capped at MaxTopologyNodes
// (500) regardless of config. At ~2,248 (intentionally unscheduled) pods in
// the isolated lab this produced a 4,888-node / 8.1MB / 16.27s response —
// live-reproduced. These tests prove the default is now bounded, and that
// an explicit ?max_nodes= override still works (the dangerous behavior
// remains available, opt-in, not removed).

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// recordingTopologyService wraps noopTopologyService, additionally
// recording the maxNodes value GetTopologyWithClient was actually called
// with — the thing this fix changes.
type recordingTopologyService struct {
	noopTopologyService
	lastMaxNodes int
}

func (s *recordingTopologyService) GetTopologyWithClient(_ context.Context, _ *k8s.Client, _ string, _ models.TopologyFilters, maxNodes int, _ bool) (*models.TopologyGraph, error) {
	s.lastMaxNodes = maxNodes
	return &models.TopologyGraph{
		Nodes:    []models.TopologyNode{},
		Edges:    []models.TopologyEdge{},
		Metadata: models.TopologyGraphMetadata{IsComplete: true},
	}, nil
}

func newTopologyV1TestHandler(t *testing.T, clusterID string, ts *recordingTopologyService) (*Handler, *mux.Router) {
	t.Helper()
	cluster := &models.Cluster{ID: clusterID, Name: clusterID, Context: clusterID, Status: "connected"}
	cs := &mockClusterService{
		clusterMap: map[string]*models.Cluster{clusterID: cluster},
		clusters:   []*models.Cluster{cluster},
		clientMap:  map[string]*k8s.Client{clusterID: k8s.NewClientForTest(nil)},
	}
	h := NewHandler(cs, ts, nil, nil, &mockEventsService{}, nil, nil, nil, nil, nil, nil, nil)
	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)
	return h, router
}

func TestGetTopologyV1_DefaultsToBoundedMaxNodes(t *testing.T) {
	clusterID := "v1-default-cluster"
	ts := &recordingTopologyService{}
	_, router := newTopologyV1TestHandler(t, clusterID, ts)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/topology", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ts.lastMaxNodes != MaxTopologyNodes {
		t.Fatalf("default maxNodes = %d, want %d (MaxTopologyNodes) — the dangerous unbounded-by-default behavior has returned", ts.lastMaxNodes, MaxTopologyNodes)
	}
}

func TestGetTopologyV1_ExplicitMaxNodesOverrideStillWorks(t *testing.T) {
	clusterID := "v1-override-cluster"
	ts := &recordingTopologyService{}
	_, router := newTopologyV1TestHandler(t, clusterID, ts)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/topology?max_nodes=0", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ts.lastMaxNodes != 0 {
		t.Fatalf("explicit max_nodes=0 override: got maxNodes=%d, want 0 (caller explicitly opted into the unbounded form)", ts.lastMaxNodes)
	}

	// A specific positive override must also be honored exactly.
	ts2 := &recordingTopologyService{}
	_, router2 := newTopologyV1TestHandler(t, clusterID, ts2)
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/topology?max_nodes=1200", nil)
	rec2 := httptest.NewRecorder()
	router2.ServeHTTP(rec2, req2)
	if ts2.lastMaxNodes != 1200 {
		t.Fatalf("explicit max_nodes=1200 override: got maxNodes=%d, want 1200", ts2.lastMaxNodes)
	}
}
