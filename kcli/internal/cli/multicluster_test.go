package cli

import "testing"

func TestParseMultiClusterOptions(t *testing.T) {
	t.Run("regular args", func(t *testing.T) {
		opts, err := parseMultiClusterOptions([]string{"pods", "-A"})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if opts.AllContexts {
			t.Fatalf("expected AllContexts false")
		}
		if len(opts.Args) != 2 {
			t.Fatalf("expected args passthrough, got %v", opts.Args)
		}
	})

	t.Run("all contexts with group", func(t *testing.T) {
		opts, err := parseMultiClusterOptions([]string{"pods", "--all-contexts", "--context-group=prod"})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !opts.AllContexts {
			t.Fatalf("expected AllContexts true")
		}
		if opts.Group != "prod" {
			t.Fatalf("expected group prod, got %q", opts.Group)
		}
		if len(opts.Args) != 1 || opts.Args[0] != "pods" {
			t.Fatalf("expected cleaned args, got %v", opts.Args)
		}
	})

	t.Run("missing group value", func(t *testing.T) {
		_, err := parseMultiClusterOptions([]string{"pods", "--context-group"})
		if err == nil {
			t.Fatalf("expected error")
		}
	})
}

func TestHasNamespaceFlag(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want bool
	}{
		{name: "short form", args: []string{"pods", "-n", "default"}, want: true},
		{name: "long form", args: []string{"pods", "--namespace", "default"}, want: true},
		{name: "long equals", args: []string{"pods", "--namespace=default"}, want: true},
		{name: "none", args: []string{"pods", "-A"}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := hasNamespaceFlag(tc.args)
			if got != tc.want {
				t.Fatalf("hasNamespaceFlag(%v)=%v, want %v", tc.args, got, tc.want)
			}
		})
	}
}
