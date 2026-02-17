package main

import (
	"reflect"
	"testing"
)

func TestFirstCommandToken(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{name: "plain command", args: []string{"cp", "a", "b"}, want: "cp"},
		{name: "with scope flags", args: []string{"--context", "prod", "-n", "default", "cp", "a", "b"}, want: "cp"},
		{name: "with inline flags", args: []string{"--context=prod", "--namespace=default", "cp", "a", "b"}, want: "cp"},
		{name: "kcli-only flags", args: []string{"--ai-timeout", "5s", "cp", "a", "b"}, want: "cp"},
		{name: "only flags", args: []string{"--force", "-n", "default"}, want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := firstCommandToken(tc.args)
			if got != tc.want {
				t.Fatalf("firstCommandToken(%v)=%q want %q", tc.args, got, tc.want)
			}
		})
	}
}

func TestStripKCLIOnlyFlags(t *testing.T) {
	gotArgs, force, err := stripKCLIOnlyFlags([]string{"--force", "--ai-timeout", "5s", "--completion-timeout=200ms", "--context", "prod", "cp", "a", "b"})
	if err != nil {
		t.Fatalf("stripKCLIOnlyFlags returned error: %v", err)
	}
	wantArgs := []string{"--context", "prod", "cp", "a", "b"}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("args mismatch: got %v want %v", gotArgs, wantArgs)
	}
	if !force {
		t.Fatal("expected force=true")
	}
}

func TestShouldFallbackToKubectl(t *testing.T) {
	if !shouldFallbackToKubectl([]string{"cp", "a", "b"}) {
		t.Fatal("expected fallback for cp")
	}
	if shouldFallbackToKubectl([]string{"get", "pods"}) {
		t.Fatal("did not expect fallback for built-in get")
	}
}
