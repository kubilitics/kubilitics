package ui

import (
	"io"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestResolveResourceSpec(t *testing.T) {
	cases := []string{":pods", "po", ":deploy", "service", ":nodes", ":events", ":ns", ":ing", ":cm", ":secrets", ":pvc", ":jobs", ":cronjobs"}
	for _, in := range cases {
		if _, ok := resolveResourceSpec(in); !ok {
			t.Fatalf("expected resolveResourceSpec(%q) to succeed", in)
		}
	}
	if _, ok := resolveResourceSpec(":unknown"); ok {
		t.Fatal("expected unknown shortcut to fail")
	}
}

func TestSpecForKind(t *testing.T) {
	cases := []string{"Deployment", "Pod", "Service", "Ingress", "ReplicaSet", "Endpoints"}
	for _, in := range cases {
		if _, ok := specForKind(in); !ok {
			t.Fatalf("expected specForKind(%q) to succeed", in)
		}
	}
}

func TestCommandModeSwitchResource(t *testing.T) {
	m := initialModel(Options{})
	if m.spec.Key != "pods" {
		t.Fatalf("expected default pods, got %s", m.spec.Key)
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{':'}})
	m2 := updated.(model)
	if !m2.cmdMode {
		t.Fatal("expected command mode enabled")
	}

	for _, r := range []rune("deploy") {
		updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m2 = updated.(model)
	}
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m2 = updated.(model)
	if m2.spec.Key != "deploy" {
		t.Fatalf("expected switched resource deploy, got %s", m2.spec.Key)
	}
}

func TestFilteringAndSortingRows(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
		{Namespace: "default", Name: "worker-0", Columns: []string{"default", "worker-0", "1/1", "Running", "2", "2m", "n2"}},
		{Namespace: "ops", Name: "job-0", Columns: []string{"ops", "job-0", "0/1", "Pending", "0", "1m", "n3"}},
	}
	m.refreshFiltered()

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	m2 := updated.(model)
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'o'}})
	m2 = updated.(model)
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	m2 = updated.(model)
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m2 = updated.(model)
	if len(m2.filtered) != 1 || m2.filtered[0].Namespace != "ops" {
		t.Fatalf("unexpected filtered rows: %+v", m2.filtered)
	}

	m2.filterInput.SetValue("")
	m2.refreshFiltered()
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'5'}}) // restarts column index
	m2 = updated.(model)
	if m2.filtered[len(m2.filtered)-1].Name != "worker-0" {
		t.Fatalf("expected worker-0 last after asc sort, got %+v", m2.filtered)
	}
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'S'}})
	m2 = updated.(model)
	if m2.filtered[0].Name != "worker-0" {
		t.Fatalf("expected worker-0 first after desc sort, got %+v", m2.filtered)
	}
}

func TestRegexAndFieldFiltering(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":pods")
	m.rows = []resourceRow{
		{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "5m", "n1"}},
		{Namespace: "default", Name: "worker-0", Columns: []string{"default", "worker-0", "1/1", "CrashLoopBackOff", "2", "2m", "n2"}},
	}
	m.filterInput.SetValue("status:Running")
	m.refreshFiltered()
	if len(m.filtered) != 1 || m.filtered[0].Name != "api-0" {
		t.Fatalf("field filter failed: %+v", m.filtered)
	}

	m.filterInput.SetValue("re:^default\\s+worker")
	m.refreshFiltered()
	if len(m.filtered) != 1 || m.filtered[0].Name != "worker-0" {
		t.Fatalf("regex filter failed: %+v", m.filtered)
	}
}

func TestMultiSelectAndBulkParsing(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":deploy")
	m.filtered = []resourceRow{
		{Namespace: "default", Name: "api", Columns: []string{"default", "api", "1/1", "1", "1", "2m"}},
		{Namespace: "default", Name: "worker", Columns: []string{"default", "worker", "1/1", "1", "1", "2m"}},
	}

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{' '}})
	m2 := updated.(model)
	if len(m2.selectedRows) != 1 {
		t.Fatalf("expected one selected row, got %d", len(m2.selectedRows))
	}

	m2.selected = 1
	updated, _ = m2.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{' '}})
	m2 = updated.(model)
	if len(m2.selectedRows) != 2 {
		t.Fatalf("expected two selected rows, got %d", len(m2.selectedRows))
	}

	req, err := m2.parseBulkRequest("scale=3")
	if err != nil {
		t.Fatalf("parseBulkRequest scale error: %v", err)
	}
	if req.Action != "scale" || req.Replicas != 3 || len(req.Targets) != 2 {
		t.Fatalf("unexpected bulk req: %+v", req)
	}
}

func TestThemeToggle(t *testing.T) {
	m := initialModel(Options{})
	initial := m.themeIndex
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlT})
	m2 := updated.(model)
	if m2.themeIndex == initial {
		t.Fatal("expected theme index to change on ctrl+t")
	}
}

func TestInitialThemeFromOptions(t *testing.T) {
	m := initialModel(Options{Theme: "forest", Animations: true})
	if m.themeIndex != 1 {
		t.Fatalf("expected forest theme index 1, got %d", m.themeIndex)
	}
}

func TestAIToggle(t *testing.T) {
	m := initialModel(Options{AIEnabled: true})
	if !m.aiEnabled {
		t.Fatal("expected AI enabled initially")
	}
	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlA})
	m2 := updated.(model)
	if m2.aiEnabled {
		t.Fatal("expected AI disabled after ctrl+a")
	}
}

func TestSaveSnapshot(t *testing.T) {
	m := initialModel(Options{Context: "docker-desktop"})
	m.filtered = []resourceRow{
		{Namespace: "default", Name: "api", Columns: []string{"default", "api", "1/1", "Running", "0", "1m", "n1"}},
	}
	p, err := m.saveSnapshot()
	if err != nil {
		t.Fatalf("saveSnapshot error: %v", err)
	}
	if !strings.Contains(p, "kcli-ui-pods-") {
		t.Fatalf("unexpected snapshot path: %s", p)
	}
}

func TestBulkConfirmRequiresYes(t *testing.T) {
	m := initialModel(Options{})
	m.spec, _ = resolveResourceSpec(":deploy")
	m.filtered = []resourceRow{{Namespace: "default", Name: "api", Columns: []string{"default", "api", "1/1", "1", "1", "2m"}}}
	m.selectedRows[m.rowKey(m.filtered[0])] = true
	m.pendingBulk = bulkRequest{Action: "delete", Targets: m.filtered}
	m.confirmMode = true
	m.confirmInput.SetValue("no")

	updated, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m2 := updated.(model)
	if m2.confirmMode {
		t.Fatal("expected confirm mode to close")
	}
	if !strings.Contains(strings.ToLower(m2.detail), "cancelled") {
		t.Fatalf("expected cancellation detail message, got %q", m2.detail)
	}
}

func TestParseFunctions(t *testing.T) {
	if row, ok := parsePodsLine("default api-0 1/1 Running 3 12m 10.1.0.1 node-1 <none> <none>", ""); !ok || row.Name != "api-0" {
		t.Fatalf("parsePodsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseDeploymentsLine("default api 1/1 1 1 2m", ""); !ok || row.Name != "api" {
		t.Fatalf("parseDeploymentsLine failed: %+v %v", row, ok)
	}
	if row, ok := parseServicesLine("default svc ClusterIP 10.0.0.1 <none> 80/TCP 2m", ""); !ok || row.Name != "svc" {
		t.Fatalf("parseServicesLine failed: %+v %v", row, ok)
	}
}

func TestFlattenXray(t *testing.T) {
	root := &xrayNode{
		Kind:      "Deployment",
		Namespace: "default",
		Name:      "api",
		Children: []*xrayNode{
			{Kind: "ReplicaSet", Namespace: "default", Name: "api-rs", Children: []*xrayNode{{Kind: "Pod", Namespace: "default", Name: "api-0"}}},
			{Kind: "Service", Namespace: "default", Name: "api-svc"},
		},
	}
	out := flattenXray(root)
	if len(out) < 3 {
		t.Fatalf("expected flattened xray nodes, got %d", len(out))
	}
	if !strings.Contains(out[0].Line, "Deployment") || !strings.Contains(out[1].Line, "ReplicaSet") {
		t.Fatalf("unexpected flattened lines: %+v", out)
	}
}

func TestViewRendersFrameworkComponents(t *testing.T) {
	m := initialModel(Options{Context: "docker-desktop", Namespace: "default", AIEnabled: true})
	m.width = 120
	m.height = 36
	m.filtered = []resourceRow{{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "2m", "n1"}}}
	m.detail = "resource details"

	view := m.View()
	checks := []string{
		"kcli ui | context: docker-desktop | namespace: default | resource: pods | ai: on",
		"NAMESPACE",
		"Details",
		"q quit",
	}
	for _, want := range checks {
		if !strings.Contains(view, want) {
			t.Fatalf("view missing %q", want)
		}
	}
}

func TestDetailAITabLoads(t *testing.T) {
	m := initialModel(Options{
		AIEnabled: true,
		AIFunc: func(target string) (string, error) {
			return "analysis for " + target, nil
		},
	})
	m.spec, _ = resolveResourceSpec(":pods")
	row := resourceRow{Namespace: "default", Name: "api-0", Columns: []string{"default", "api-0", "1/1", "Running", "0", "2m", "n1"}}
	m.enterDetailMode(row)
	updated, cmd := m.switchDetailTab(tabAI)
	m2 := updated.(model)
	if !m2.detailLoading {
		t.Fatal("expected AI tab load to set detailLoading")
	}
	if cmd == nil {
		t.Fatal("expected AI tab load command")
	}
}

func TestRunProgramForTestQuitsCleanly(t *testing.T) {
	done := make(chan error, 1)
	go func() {
		done <- runProgramForTest(Options{}, strings.NewReader("q"), io.Discard)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("runProgramForTest returned error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("tui did not exit within timeout")
	}
}
