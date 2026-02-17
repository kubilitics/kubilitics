package cli

import "testing"

func TestParseNamespacedPod(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		ns, pod, err := parseNamespacedPod("team-a/api-7f9d")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ns != "team-a" || pod != "api-7f9d" {
			t.Fatalf("unexpected parse result: ns=%q pod=%q", ns, pod)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		if _, _, err := parseNamespacedPod("api-7f9d"); err == nil {
			t.Fatal("expected error for missing namespace")
		}
	})
}

func TestIncidentIncludesQuickActionSubcommands(t *testing.T) {
	cmd := newIncidentCmd(&app{})
	names := map[string]bool{}
	for _, c := range cmd.Commands() {
		names[c.Name()] = true
	}
	for _, want := range []string{"logs", "describe", "restart"} {
		if !names[want] {
			t.Fatalf("missing incident subcommand %q", want)
		}
	}
}
