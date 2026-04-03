package models

import "time"

// FleetHealthRecord stores a point-in-time snapshot of cluster structural health.
type FleetHealthRecord struct {
	ID             int       `json:"id" db:"id"`
	ClusterID      string    `json:"cluster_id" db:"cluster_id"`
	Timestamp      time.Time `json:"timestamp" db:"timestamp"`
	HealthScore    float64   `json:"health_score" db:"health_score"`
	SPOFCount      int       `json:"spof_count" db:"spof_count"`
	PDBCoverage    float64   `json:"pdb_coverage" db:"pdb_coverage"`
	HPACoverage    float64   `json:"hpa_coverage" db:"hpa_coverage"`
	NetPolCoverage float64   `json:"netpol_coverage" db:"netpol_coverage"`
	CriticalCount  int       `json:"critical_count" db:"critical_count"`
	TotalWorkloads int       `json:"total_workloads" db:"total_workloads"`
	MetricsJSON    string    `json:"metrics_json" db:"metrics_json"`
}

// GoldenTemplate defines a fleet compliance standard that clusters are measured against.
type GoldenTemplate struct {
	ID           string    `json:"id" db:"id"`
	Name         string    `json:"name" db:"name"`
	Description  string    `json:"description" db:"description"`
	Requirements string    `json:"requirements" db:"requirements"` // JSON
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
	CreatedBy    string    `json:"created_by" db:"created_by"`
}
