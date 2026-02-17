package cli

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseEventTime(t *testing.T) {
	e := k8sEvent{}
	e.LastTimestamp = "2026-02-16T10:00:00Z"
	e.EventTime = "2026-02-16T09:00:00Z"
	got := parseEventTime(e)
	if got.IsZero() {
		t.Fatalf("expected parsed timestamp")
	}
	if got.Format(time.RFC3339) != "2026-02-16T10:00:00Z" {
		t.Fatalf("expected lastTimestamp preference, got %s", got.Format(time.RFC3339))
	}
}

func TestFilterEventsByRecent(t *testing.T) {
	now := time.Date(2026, 2, 16, 12, 0, 0, 0, time.UTC)
	records := []eventRecord{
		{Timestamp: now.Add(-10 * time.Minute), Type: "Warning", Namespace: "default", Object: "Pod/a"},
		{Timestamp: now.Add(-3 * time.Hour), Type: "Warning", Namespace: "default", Object: "Pod/b"},
		{Timestamp: time.Time{}, Type: "Normal", Namespace: "default", Object: "Pod/c"},
	}
	got := filterEventsByRecent(records, 2*time.Hour, now)
	if len(got) != 2 {
		t.Fatalf("expected 2 records within window (+zero-time), got %d", len(got))
	}
	if got[0].Object != "Pod/a" {
		t.Fatalf("unexpected first record: %+v", got[0])
	}
}

func TestFilterEventsByType(t *testing.T) {
	records := []eventRecord{{Type: "Warning"}, {Type: "Normal"}, {Type: "warning"}}
	got := filterEventsByType(records, "warning")
	if len(got) != 2 {
		t.Fatalf("expected 2 warning records, got %d", len(got))
	}
}

func TestBuildRestartRecords(t *testing.T) {
	now := time.Now().UTC()
	raw := `{
  "items": [
    {
      "metadata": { "namespace": "default", "name": "api" },
      "spec": { "nodeName": "n1" },
      "status": {
        "phase": "Running",
        "containerStatuses": [
          {
            "name": "c",
            "restartCount": 3,
            "lastState": { "terminated": { "finishedAt": "` + now.Format(time.RFC3339) + `" } }
          }
        ]
      }
    },
    {
      "metadata": { "namespace": "default", "name": "worker" },
      "spec": { "nodeName": "n2" },
      "status": {
        "phase": "Running",
        "containerStatuses": [
          {
            "name": "c",
            "restartCount": 1
          }
        ]
      }
    }
  ]
}`
	var list k8sPodList
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		t.Fatalf("unmarshal test pod list: %v", err)
	}
	got := buildRestartRecords(&list, 2, now.Add(-1*time.Hour))
	if len(got) != 1 || got[0].Name != "api" {
		t.Fatalf("unexpected restart records: %+v", got)
	}
}

func TestHealthScoreBounds(t *testing.T) {
	pods := podHealthSummary{CrashLoop: 50, RestartPods: 50}
	nodes := nodeHealthSummary{Total: 3, NotReady: 3, MemoryPress: 2, DiskPress: 2, PIDPress: 2}
	score := healthScore(pods, nodes)
	if score < 0 || score > 100 {
		t.Fatalf("score out of bounds: %d", score)
	}
}
