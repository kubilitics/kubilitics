package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginInstallListRemoveCommands(t *testing.T) {
	home := t.TempDir()
	t.Setenv("KCLI_HOME_DIR", home)

	src := t.TempDir()
	bin := filepath.Join(src, "kcli-demo")
	manifest := filepath.Join(src, "plugin.yaml")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho demo\n"), 0o755); err != nil {
		t.Fatalf("write bin: %v", err)
	}
	if err := os.WriteFile(manifest, []byte("name: demo\nversion: 1.0.0\npermissions: []\n"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "install", src})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin install failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Installed plugin") {
		t.Fatalf("unexpected install output: %q", buf.String())
	}

	root = NewRootCommand()
	buf.Reset()
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "list"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin list failed: %v", err)
	}
	if !strings.Contains(buf.String(), "demo") {
		t.Fatalf("expected demo in list output: %q", buf.String())
	}

	root = NewRootCommand()
	buf.Reset()
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "remove", "demo"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin remove failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Removed plugin") {
		t.Fatalf("unexpected remove output: %q", buf.String())
	}
}

func TestPluginSearchIncludesMarketplace(t *testing.T) {
	home := t.TempDir()
	t.Setenv("KCLI_HOME_DIR", home)

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "search", "mesh"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin search failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Marketplace:") || !strings.Contains(buf.String(), "istio") {
		t.Fatalf("expected marketplace istio in output: %q", buf.String())
	}
}
