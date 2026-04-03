package autopilot

import (
	"fmt"
	"sync"
	"time"
)

// MemRepository is an in-memory implementation of AutoPilotRepository for tests and v1.
type MemRepository struct {
	mu          sync.RWMutex
	actions     []ActionRecord
	ruleConfigs map[string]map[string]RuleConfig // clusterID -> ruleID -> config
}

// NewMemRepository creates a new in-memory autopilot repository.
func NewMemRepository() *MemRepository {
	return &MemRepository{
		ruleConfigs: make(map[string]map[string]RuleConfig),
	}
}

func (r *MemRepository) ListActions(clusterID string, status string, limit, offset int) ([]ActionRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var filtered []ActionRecord
	for _, a := range r.actions {
		if a.ClusterID != clusterID {
			continue
		}
		if status != "" && a.Status != status {
			continue
		}
		filtered = append(filtered, a)
	}

	// Pagination
	if offset >= len(filtered) {
		return []ActionRecord{}, nil
	}
	filtered = filtered[offset:]
	if limit > 0 && limit < len(filtered) {
		filtered = filtered[:limit]
	}

	return filtered, nil
}

func (r *MemRepository) GetAction(actionID string) (*ActionRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for i := range r.actions {
		if r.actions[i].ID == actionID {
			a := r.actions[i]
			return &a, nil
		}
	}
	return nil, fmt.Errorf("action %s not found", actionID)
}

func (r *MemRepository) CreateAction(action *ActionRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.actions = append(r.actions, *action)
	return nil
}

func (r *MemRepository) UpdateActionStatus(actionID string, status string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i := range r.actions {
		if r.actions[i].ID == actionID {
			r.actions[i].Status = status
			r.actions[i].UpdatedAt = time.Now()
			return nil
		}
	}
	return fmt.Errorf("action %s not found", actionID)
}

func (r *MemRepository) GetLastActionTime(clusterID, ruleID, targetKind, targetNamespace, targetName string) (*time.Time, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var latest *time.Time
	for _, a := range r.actions {
		if a.ClusterID == clusterID && a.RuleID == ruleID &&
			a.TargetKind == targetKind && a.TargetNamespace == targetNamespace &&
			a.TargetName == targetName {
			t := a.CreatedAt
			if latest == nil || t.After(*latest) {
				latest = &t
			}
		}
	}
	return latest, nil
}

func (r *MemRepository) ListRuleConfigs(clusterID string) ([]RuleConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	configs, ok := r.ruleConfigs[clusterID]
	if !ok {
		return []RuleConfig{}, nil
	}

	result := make([]RuleConfig, 0, len(configs))
	for _, cfg := range configs {
		result = append(result, cfg)
	}
	return result, nil
}

func (r *MemRepository) GetRuleConfig(clusterID, ruleID string) (*RuleConfig, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	configs, ok := r.ruleConfigs[clusterID]
	if !ok {
		return nil, fmt.Errorf("no configs for cluster %s", clusterID)
	}
	cfg, ok := configs[ruleID]
	if !ok {
		return nil, fmt.Errorf("no config for rule %s in cluster %s", ruleID, clusterID)
	}
	return &cfg, nil
}

func (r *MemRepository) UpsertRuleConfig(clusterID string, config RuleConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.ruleConfigs[clusterID] == nil {
		r.ruleConfigs[clusterID] = make(map[string]RuleConfig)
	}
	r.ruleConfigs[clusterID][config.RuleID] = config
	return nil
}
