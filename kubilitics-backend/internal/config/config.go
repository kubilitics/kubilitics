package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type Config struct {
	Port                int      `mapstructure:"port"`
	DatabasePath        string   `mapstructure:"database_path"`
	LogLevel            string   `mapstructure:"log_level"`
	AllowedOrigins      []string `mapstructure:"allowed_origins"`
	KubeconfigPath      string   `mapstructure:"kubeconfig_path"`
	KubeconfigAutoLoad  bool     `mapstructure:"kubeconfig_auto_load"`    // On startup, if no clusters in DB, add all contexts from default kubeconfig (Docker Desktop, kind, etc.)
	RequestTimeoutSec   int      `mapstructure:"request_timeout_sec"`     // HTTP read/write; 0 = use server default
	TopologyTimeoutSec  int      `mapstructure:"topology_timeout_sec"`    // Topology build context timeout
	ShutdownTimeoutSec  int      `mapstructure:"shutdown_timeout_sec"`    // Graceful shutdown wait
	MaxClusters         int      `mapstructure:"max_clusters"`            // Max registered clusters (e.g. 100); 0 = default
	K8sTimeoutSec       int      `mapstructure:"k8s_timeout_sec"`         // Timeout for outbound K8s API calls; 0 = default
	TopologyCacheTTLSec int      `mapstructure:"topology_cache_ttl_sec"`  // Topology cache TTL; 0 = cache disabled
	TopologyMaxNodes    int      `mapstructure:"topology_max_nodes"`      // Max nodes per topology response; 0 = no limit (C1.4)
	K8sRateLimitPerSec  float64  `mapstructure:"k8s_rate_limit_per_sec"`  // Token bucket rate per cluster (req/s); 0 = no limit (C1.5)
	K8sRateLimitBurst   int      `mapstructure:"k8s_rate_limit_burst"`    // Token bucket burst per cluster; 0 = no limit (C1.5)
	ApplyMaxYAMLBytes   int      `mapstructure:"apply_max_yaml_bytes"`    // Max YAML body size for POST /apply (D1.2); 0 = default 512KB
	KCLIRateLimitPerSec float64  `mapstructure:"kcli_rate_limit_per_sec"` // Token bucket rate per cluster for /kcli APIs; 0 = disabled
	KCLIRateLimitBurst  int      `mapstructure:"kcli_rate_limit_burst"`   // Burst for /kcli APIs; 0 uses sane default
	KCLIStreamMaxConns  int      `mapstructure:"kcli_stream_max_conns"`   // Max concurrent /kcli/stream sessions per cluster; 0 uses default
	KCLIAllowShellMode  bool     `mapstructure:"kcli_allow_shell_mode"`   // Allow /kcli/stream?mode=shell (interactive shell)
}

func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("/etc/kubilitics/")
	viper.AddConfigPath("$HOME/.kubilitics")
	viper.AddConfigPath(".")

	// Defaults
	viper.SetDefault("port", 8080)
	viper.SetDefault("database_path", "./kubilitics.db")
	viper.SetDefault("log_level", "info")
	viper.SetDefault("allowed_origins", []string{"*"})
	viper.SetDefault("kubeconfig_path", "")
	viper.SetDefault("kubeconfig_auto_load", true)
	viper.SetDefault("request_timeout_sec", 30)
	viper.SetDefault("topology_timeout_sec", 30)
	viper.SetDefault("shutdown_timeout_sec", 15)
	viper.SetDefault("max_clusters", 100)
	viper.SetDefault("k8s_timeout_sec", 30)
	viper.SetDefault("topology_cache_ttl_sec", 30)
	viper.SetDefault("topology_max_nodes", 5000)  // recommended cap for large clusters (C1.4)
	viper.SetDefault("k8s_rate_limit_per_sec", 0) // 0 = disabled
	viper.SetDefault("k8s_rate_limit_burst", 0)
	viper.SetDefault("apply_max_yaml_bytes", 512*1024) // 512KB default for apply (D1.2)
	viper.SetDefault("kcli_rate_limit_per_sec", 12.0)
	viper.SetDefault("kcli_rate_limit_burst", 24)
	viper.SetDefault("kcli_stream_max_conns", 4)
	viper.SetDefault("kcli_allow_shell_mode", true)

	// Environment variables
	viper.SetEnvPrefix("KUBILITICS")
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config: %w", err)
		}
		// Config file not found; using defaults and env vars
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}
