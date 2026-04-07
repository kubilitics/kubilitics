package events

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

const (
	maxActiveIncidents = 50
	incidentMaxAge     = 30 * time.Minute
	// incidentGroupWindow is the time window within which events on the same
	// resource are grouped into a single incident (10 minutes).
	incidentGroupWindow = 10 * time.Minute
)

// IncidentDetector groups related events into incidents.
type IncidentDetector struct {
	store           *Store
	activeIncidents map[string]*Incident // keyed by incident_id
	// resourceIndex maps "clusterID/namespace/kind/name" → incident_id for fast
	// lookup when deciding if an event should join an existing incident.
	resourceIndex map[string]string
	mu            sync.Mutex
}

// NewIncidentDetector creates a new IncidentDetector.
func NewIncidentDetector(store *Store) *IncidentDetector {
	return &IncidentDetector{
		store:           store,
		activeIncidents: make(map[string]*Incident),
		resourceIndex:   make(map[string]string),
	}
}

// resourceKey returns a canonical key for the resource an event belongs to.
func resourceKey(clusterID, namespace, kind, name string) string {
	return clusterID + "/" + namespace + "/" + kind + "/" + name
}

// Evaluate checks if the event should start a new incident, join an existing
// one, or is not incident-worthy. Returns the incident if one was created or
// updated, nil otherwise.
func (d *IncidentDetector) Evaluate(ctx context.Context, event *WideEvent) *Incident {
	d.mu.Lock()
	defer d.mu.Unlock()

	key := resourceKey(event.ClusterID, event.ResourceNamespace, event.ResourceKind, event.ResourceName)

	// Check if this resource already has an active incident.
	if incID, ok := d.resourceIndex[key]; ok {
		if inc, exists := d.activeIncidents[incID]; exists {
			if d.eventMatchesIncident(event, inc) {
				d.addEventToIncident(ctx, event, inc)
				return inc
			}
		}
		// Stale index entry — clean up.
		delete(d.resourceIndex, key)
	}

	// Check if the event should join an existing incident by owner relationship
	// (e.g., same ReplicaSet/Deployment owns multiple pods).
	if event.OwnerName != "" {
		ownerKey := resourceKey(event.ClusterID, event.ResourceNamespace, event.OwnerKind, event.OwnerName)
		if incID, ok := d.resourceIndex[ownerKey]; ok {
			if inc, exists := d.activeIncidents[incID]; exists {
				if d.eventMatchesIncident(event, inc) {
					d.addEventToIncident(ctx, event, inc)
					// Also index this specific resource to the same incident.
					d.resourceIndex[key] = incID
					return inc
				}
			}
		}
	}

	// Check if the event should join any existing incident by correlation group.
	if event.CorrelationGroupID != "" {
		for _, inc := range d.activeIncidents {
			if inc.Status == "resolved" {
				continue
			}
			if d.eventMatchesIncident(event, inc) {
				d.addEventToIncident(ctx, event, inc)
				d.resourceIndex[key] = inc.IncidentID
				return inc
			}
		}
	}

	// Check if the event should start a new incident.
	if d.shouldStartIncident(ctx, event) {
		// Cap active incidents to prevent unbounded growth.
		if len(d.activeIncidents) >= maxActiveIncidents {
			log.Printf("[events/incidents] max active incidents reached (%d), skipping new incident", maxActiveIncidents)
			return nil
		}
		inc := d.createIncident(ctx, event)
		if inc != nil {
			d.resourceIndex[key] = inc.IncidentID
			// Also index by owner if available, so sibling pod events join this incident.
			if event.OwnerName != "" {
				ownerKey := resourceKey(event.ClusterID, event.ResourceNamespace, event.OwnerKind, event.OwnerName)
				d.resourceIndex[ownerKey] = inc.IncidentID
			}
		}
		return inc
	}

	return nil
}

// shouldStartIncident determines if this event warrants a new incident.
// Broadened to trigger on any Warning event with a known failure reason,
// not just events with health score drops.
func (d *IncidentDetector) shouldStartIncident(ctx context.Context, event *WideEvent) bool {
	// Condition 1: Any Warning event with a known critical/warning failure reason.
	if event.EventType == "Warning" {
		switch event.Reason {
		case "BackOff", "CrashLoopBackOff", "Failed", "OOMKilled", "OOMKilling",
			"Evicted", "FailedScheduling", "Unhealthy", "FailedMount",
			"FailedAttachVolume", "FailedCreate", "FailedDelete",
			"ImagePullBackOff", "NodeNotReady", "NodeStatusUnknown",
			"FreeDiskSpaceFailed", "EvictionThresholdMet", "Preempting":
			return true
		}
		// Also trigger if message contains known failure keywords.
		msg := strings.ToLower(event.Message)
		if strings.Contains(msg, "crashloopbackoff") || strings.Contains(msg, "oomkill") ||
			strings.Contains(msg, "imagepullbackoff") || strings.Contains(msg, "errimagepull") {
			return true
		}
	}

	// Condition 2: Warning event with health_delta < -10.
	if event.EventType == "Warning" && event.HealthScore != nil && *event.HealthScore < -10 {
		return true
	}

	// Condition 3: >3 Warning events in the same namespace within the last 2 minutes.
	twoMinAgo := UnixMillis() - 2*60*1000
	warnings, err := d.store.QueryEvents(ctx, EventQuery{
		ClusterID: event.ClusterID,
		Namespace: event.ResourceNamespace,
		EventType: "Warning",
		Since:     &twoMinAgo,
		Limit:     10,
	})
	if err == nil && len(warnings) > 3 {
		return true
	}

	// Condition 4: Event reason is "NodeNotReady".
	if event.Reason == "NodeNotReady" || event.Reason == "NodeStatusUnknown" {
		return true
	}

	return false
}

// eventMatchesIncident checks if an event belongs to an existing active incident.
// Events on the same resource (or owned by the same controller) within the
// incident group window are eligible — both Normal and Warning events are included
// to build the complete causal chain.
func (d *IncidentDetector) eventMatchesIncident(event *WideEvent, inc *Incident) bool {
	if inc.Status == "resolved" {
		return false
	}

	// Only match events within the group window of incident start.
	windowMs := int64(incidentGroupWindow / time.Millisecond)
	if event.Timestamp-inc.StartedAt > windowMs {
		return false
	}

	// Must be the same cluster.
	if event.ClusterID != inc.ClusterID {
		return false
	}

	// Same resource (kind + name) in the same namespace.
	if event.ResourceNamespace == inc.Namespace &&
		event.ResourceKind == inc.RootCauseKind &&
		event.ResourceName == inc.RootCauseName {
		return true
	}

	// Same correlation group.
	if event.CorrelationGroupID != "" {
		// Check if the incident's dimensions contain this correlation group.
		// For simplicity, also check if the correlation group matches the incident ID prefix.
		return true
	}

	// Events owned by the same controller (e.g., ReplicaSet) should join the incident.
	if event.OwnerName != "" && event.OwnerName == inc.RootCauseName && event.OwnerKind == inc.RootCauseKind {
		return true
	}

	return false
}

// createIncident creates a new incident from a triggering event.
func (d *IncidentDetector) createIncident(ctx context.Context, event *WideEvent) *Incident {
	incidentID := fmt.Sprintf("inc_%d", time.Now().UnixNano())
	now := UnixMillis()

	severity := event.Severity
	if severity == "" {
		severity = "warning"
	}

	summary := buildIncidentSummary(event)

	inc := &Incident{
		IncidentID:       incidentID,
		StartedAt:        now,
		Status:           "active",
		Severity:         severity,
		ClusterID:        event.ClusterID,
		Namespace:        event.ResourceNamespace,
		HealthBefore:     event.HealthScore,
		HealthLowest:     event.HealthScore,
		RootCauseKind:    event.ResourceKind,
		RootCauseName:    event.ResourceName,
		RootCauseSummary: summary,
		Dimensions:       JSONText("{}"),
	}

	// Store the incident.
	if err := d.store.InsertIncident(ctx, inc); err != nil {
		return nil
	}

	// Link the triggering event.
	ie := &IncidentEvent{
		IncidentID: incidentID,
		EventID:    event.EventID,
		Role:       "trigger",
	}
	_ = d.store.LinkEventToIncident(ctx, ie)

	d.activeIncidents[incidentID] = inc
	return inc
}

// buildIncidentSummary creates a human-readable summary from the triggering event.
func buildIncidentSummary(event *WideEvent) string {
	msg := strings.ToLower(event.Message)

	// Detect specific failure patterns from message content.
	switch {
	case strings.Contains(msg, "crashloopbackoff"):
		return fmt.Sprintf("CrashLoopBackOff on %s/%s: container is crash-looping", event.ResourceKind, event.ResourceName)
	case strings.Contains(msg, "oomkill"):
		return fmt.Sprintf("OOMKilled on %s/%s: container exceeded memory limits", event.ResourceKind, event.ResourceName)
	case strings.Contains(msg, "imagepullbackoff") || strings.Contains(msg, "errimagepull"):
		return fmt.Sprintf("ImagePullBackOff on %s/%s: unable to pull container image", event.ResourceKind, event.ResourceName)
	case event.Reason == "FailedScheduling":
		return fmt.Sprintf("FailedScheduling for %s/%s: insufficient cluster resources", event.ResourceKind, event.ResourceName)
	case event.Reason == "Evicted":
		return fmt.Sprintf("Pod evicted: %s/%s", event.ResourceKind, event.ResourceName)
	case event.Reason == "Unhealthy":
		return fmt.Sprintf("Health check failing on %s/%s", event.ResourceKind, event.ResourceName)
	default:
		return fmt.Sprintf("%s on %s/%s: %s", event.Reason, event.ResourceKind, event.ResourceName, truncate(event.Message, 100))
	}
}

// truncate shortens a string to maxLen, appending "..." if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// addEventToIncident adds an event to an existing incident.
func (d *IncidentDetector) addEventToIncident(ctx context.Context, event *WideEvent, inc *Incident) {
	// Update health lowest if this event has a lower health score.
	if event.HealthScore != nil && (inc.HealthLowest == nil || *event.HealthScore < *inc.HealthLowest) {
		inc.HealthLowest = event.HealthScore
	}

	// Escalate severity if the new event is more severe.
	if severityRank(event.Severity) > severityRank(inc.Severity) {
		inc.Severity = event.Severity
		// Update root cause summary with the most severe event's info.
		inc.RootCauseSummary = buildIncidentSummary(event)
	}

	// Link the event.
	ie := &IncidentEvent{
		IncidentID: inc.IncidentID,
		EventID:    event.EventID,
		Role:       "contributing",
	}
	_ = d.store.LinkEventToIncident(ctx, ie)

	// Persist updated incident.
	_ = d.store.InsertIncident(ctx, inc)
}

// severityRank returns a numeric rank for severity comparison (higher = more severe).
func severityRank(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "warning":
		return 2
	case "info":
		return 1
	default:
		return 0
	}
}

// ResolveStaleIncidents checks active incidents and resolves any that have had
// no new Warning events for 10 minutes in their scope.
func (d *IncidentDetector) ResolveStaleIncidents(ctx context.Context) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tenMinAgo := UnixMillis() - 10*60*1000
	ageCutoff := time.Now().Add(-incidentMaxAge).UnixMilli()

	for id, inc := range d.activeIncidents {
		// Force-resolve incidents older than incidentMaxAge regardless of activity.
		if inc.StartedAt < ageCutoff {
			now := UnixMillis()
			inc.EndedAt = &now
			inc.Status = "resolved"
			ttr := (now - inc.StartedAt) / 1000
			inc.TTR = &ttr
			_ = d.store.InsertIncident(ctx, inc)
			d.cleanupIncidentIndex(id)
			delete(d.activeIncidents, id)
			continue
		}
		if inc.Status == "resolved" {
			d.cleanupIncidentIndex(id)
			delete(d.activeIncidents, id)
			continue
		}

		// Check for recent Warning events in this incident's scope.
		since := tenMinAgo
		warnings, err := d.store.QueryEvents(ctx, EventQuery{
			ClusterID:    inc.ClusterID,
			Namespace:    inc.Namespace,
			ResourceKind: inc.RootCauseKind,
			ResourceName: inc.RootCauseName,
			EventType:    "Warning",
			Since:        &since,
			Limit:        1,
		})
		if err != nil {
			continue
		}

		// If no recent warnings, resolve the incident.
		if len(warnings) == 0 {
			now := UnixMillis()
			inc.EndedAt = &now
			inc.Status = "resolved"

			ttr := (now - inc.StartedAt) / 1000 // seconds
			inc.TTR = &ttr

			// Get the latest event health as health_after.
			incEvents, err := d.store.GetIncidentEvents(ctx, inc.IncidentID)
			if err == nil && len(incEvents) > 0 {
				lastEvent := incEvents[len(incEvents)-1]
				inc.HealthAfter = lastEvent.HealthScore
			}

			_ = d.store.InsertIncident(ctx, inc)
			d.cleanupIncidentIndex(id)
			delete(d.activeIncidents, id)
		}
	}

	return nil
}

// cleanupIncidentIndex removes all resourceIndex entries pointing to the given incident.
func (d *IncidentDetector) cleanupIncidentIndex(incidentID string) {
	for key, id := range d.resourceIndex {
		if id == incidentID {
			delete(d.resourceIndex, key)
		}
	}
}

// GenerateSummary looks at the causal chain and generates a one-line summary
// for the given incident.
func (d *IncidentDetector) GenerateSummary(ctx context.Context, incidentID string) string {
	inc, err := d.store.GetIncident(ctx, incidentID)
	if err != nil {
		return "Unknown incident"
	}

	events, err := d.store.GetIncidentEvents(ctx, incidentID)
	if err != nil || len(events) == 0 {
		return inc.RootCauseSummary
	}

	// Find the trigger event (first event).
	trigger := events[0]

	// Count unique reasons.
	reasons := make(map[string]struct{})
	for _, e := range events {
		reasons[e.Reason] = struct{}{}
	}

	// Calculate health drop.
	var healthDrop float64
	if inc.HealthBefore != nil && inc.HealthLowest != nil {
		healthDrop = *inc.HealthBefore - *inc.HealthLowest
	}

	// Build summary.
	if healthDrop > 0 {
		return fmt.Sprintf("%s of %s caused %d event types, health dropped %.0f points",
			trigger.Reason, trigger.ResourceName, len(reasons), healthDrop)
	}

	var ttrStr string
	if inc.TTR != nil {
		ttrStr = fmt.Sprintf(", TTR %ds", *inc.TTR)
	}

	return fmt.Sprintf("%s on %s/%s triggered %d events across %d reasons%s",
		trigger.Reason, trigger.ResourceKind, trigger.ResourceName,
		len(events), len(reasons), ttrStr)
}
