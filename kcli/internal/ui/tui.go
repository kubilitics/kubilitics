package ui

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type Options struct {
	Context         string
	Namespace       string
	Kubeconfig      string
	AIEnabled       bool
	AIFunc          func(target string) (string, error)
	RefreshInterval time.Duration
	Theme           string
	Animations      bool
}

type detailTab int

const (
	tabOverview detailTab = iota
	tabEvents
	tabYAML
	tabAI
)

type resourceRow struct {
	Namespace string
	Name      string
	Columns   []string
}

type resourceSpec struct {
	Key          string
	Aliases      []string
	DisplayName  string
	Kind         string
	KubectlType  string
	Namespaced   bool
	Headers      []string
	Widths       []int
	SupportsLogs bool
	SupportsAI   bool
	ParseLine    func(line, scopedNamespace string) (resourceRow, bool)
}

type xrayNode struct {
	Kind      string
	Namespace string
	Name      string
	Children  []*xrayNode
}

type xrayDisplayNode struct {
	Kind      string
	Namespace string
	Name      string
	Line      string
}

type bulkRequest struct {
	Action   string
	Replicas int
	Targets  []resourceRow
}

type model struct {
	opts          Options
	spec          resourceSpec
	rows          []resourceRow
	filtered      []resourceRow
	selected      int
	filtering     bool
	filterInput   textinput.Model
	cmdMode       bool
	cmdInput      textinput.Model
	detail        string
	err           string
	width         int
	height        int
	frame         int
	sortColumn    int
	sortDesc      bool
	detailMode    bool
	detailRow     resourceRow
	activeTab     detailTab
	detailCache   map[detailTab]string
	detailErr     string
	detailLoading bool
	detailScrollY int // line offset for scrolling detail content

	xrayMode     bool
	xrayNodes    []xrayDisplayNode
	xraySelected int
	xrayErr      string
	xrayLoading  bool

	selectedRows map[string]bool
	wideMode     bool
	themeIndex   int
	aiEnabled    bool

	bulkMode     bool
	bulkInput    textinput.Model
	confirmMode  bool
	confirmInput textinput.Model
	pendingBulk  bulkRequest

	showHelp bool // ? toggles shortcut help overlay
}

type resourcesLoadedMsg struct {
	rows []resourceRow
	err  error
}

type sideDetailLoadedMsg struct {
	detail string
	err    error
}

type detailTabLoadedMsg struct {
	tab     detailTab
	content string
	err     error
}

type xrayLoadedMsg struct {
	nodes []xrayDisplayNode
	err   error
}

type bulkResultMsg struct {
	summary string
	err     error
}

type editDoneMsg struct{}

type tickMsg time.Time

type refreshTickMsg time.Time

type themePalette struct {
	name string
	head string
	nav  string
	sel  string
}

var (
	headerStyle  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("229")).Background(lipgloss.Color("24")).Padding(0, 1)
	navStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("45")).Padding(0, 1)
	paneStyle    = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("238")).Padding(0, 1)
	listTitle    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("117"))
	footerStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Padding(0, 1)
	selectedRow  = lipgloss.NewStyle().Foreground(lipgloss.Color("229")).Background(lipgloss.Color("57")).Padding(0, 1)
	runningStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	pendingStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	failedStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
	tabActive    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("229")).Background(lipgloss.Color("25")).Padding(0, 1)
	tabInactive  = lipgloss.NewStyle().Foreground(lipgloss.Color("245")).Padding(0, 1)
	yamlKeyStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("81"))
	helpBoxStyle = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("45")).Padding(1, 2)
	helpTitle    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("117"))
)

var spinnerFrames = []string{"-", "\\", "|", "/"}

var themes = []themePalette{
	{name: "Ocean", head: "24", nav: "45", sel: "57"},
	{name: "Forest", head: "22", nav: "78", sel: "28"},
	{name: "Amber", head: "130", nav: "214", sel: "166"},
}

func Run(opts Options) error {
	return runProgram(opts, tea.WithAltScreen())
}

func runProgram(opts Options, programOptions ...tea.ProgramOption) error {
	m := initialModel(opts)
	p := tea.NewProgram(m, programOptions...)
	_, err := p.Run()
	return err
}

func initialModel(opts Options) model {
	filter := textinput.New()
	filter.Placeholder = "filter resources"
	filter.CharLimit = 128
	filter.Width = 40

	cmd := textinput.New()
	cmd.Placeholder = ":pods, :deploy, :svc, :nodes, :events, :ns, :ing, :cm, :secrets, :pvc, :jobs, :cronjobs"
	cmd.CharLimit = 64
	cmd.Width = 80

	bulk := textinput.New()
	bulk.Placeholder = "delete OR scale=<replicas>"
	bulk.CharLimit = 32
	bulk.Width = 32

	confirm := textinput.New()
	confirm.Placeholder = "type yes to confirm"
	confirm.CharLimit = 8
	confirm.Width = 16

	themeIdx := themeIndexByName(opts.Theme)
	applyTheme(themeIdx)

	return model{
		opts:         opts,
		spec:         defaultResourceSpec(),
		filterInput:  filter,
		cmdInput:     cmd,
		bulkInput:    bulk,
		confirmInput: confirm,
		width:        120,
		height:       36,
		sortColumn:   1,
		detailCache:  map[detailTab]string{},
		selectedRows: map[string]bool{},
		themeIndex:   themeIdx,
		aiEnabled:    opts.AIFunc != nil || opts.AIEnabled,
	}
}

func (m model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		loadResourcesCmd(m.opts, m.spec),
		refreshTickCmdFn(m.opts.RefreshInterval),
	}
	if m.opts.Animations {
		cmds = append(cmds, tickCmd())
	}
	return tea.Batch(cmds...)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tickMsg:
		if !m.opts.Animations {
			return m, nil
		}
		m.frame = (m.frame + 1) % len(spinnerFrames)
		return m, tickCmd()
	case refreshTickMsg:
		return m, tea.Batch(loadResourcesCmd(m.opts, m.spec), refreshTickCmdFn(m.opts.RefreshInterval))
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		if m.showHelp {
			if msg.String() == "?" || msg.String() == "esc" {
				m.showHelp = false
			}
			return m, nil
		}
		if m.xrayMode {
			switch msg.String() {
			case "ctrl+c", "q":
				return m, tea.Quit
			case "esc":
				m.xrayMode = false
				m.xrayErr = ""
				return m, nil
			case "up", "k":
				if m.xraySelected > 0 {
					m.xraySelected--
				}
				return m, nil
			case "down", "j":
				if m.xraySelected < len(m.xrayNodes)-1 {
					m.xraySelected++
				}
				return m, nil
			case "r":
				if r, ok := m.currentRow(); ok {
					m.xrayLoading = true
					return m, loadXrayCmd(m.opts, m.spec, r)
				}
			case "enter":
				if len(m.xrayNodes) == 0 || m.xraySelected < 0 || m.xraySelected >= len(m.xrayNodes) {
					return m, nil
				}
				n := m.xrayNodes[m.xraySelected]
				spec, ok := specForKind(n.Kind)
				if !ok {
					m.xrayErr = fmt.Sprintf("no resource view configured for %s", n.Kind)
					return m, nil
				}
				m.spec = spec
				m.sortColumn = 1
				m.sortDesc = false
				m.selected = 0
				m.filterInput.SetValue("")
				m.detail = ""
				m.xrayMode = false
				m.selectedRows = map[string]bool{}
				m.refreshFiltered()
				return m, loadResourcesCmd(m.opts, m.spec)
			}
			return m, nil
		}
		if m.confirmMode {
			switch msg.String() {
			case "esc":
				m.confirmMode = false
				m.confirmInput.Blur()
				m.confirmInput.SetValue("")
				m.pendingBulk = bulkRequest{}
				return m, nil
			case "enter":
				v := strings.TrimSpace(strings.ToLower(m.confirmInput.Value()))
				m.confirmMode = false
				m.confirmInput.Blur()
				m.confirmInput.SetValue("")
				if v != "yes" {
					m.detail = "Bulk operation cancelled."
					m.pendingBulk = bulkRequest{}
					return m, nil
				}
				req := m.pendingBulk
				m.pendingBulk = bulkRequest{}
				return m, runBulkCmd(m.opts, m.spec, req)
			default:
				var cmd tea.Cmd
				m.confirmInput, cmd = m.confirmInput.Update(msg)
				return m, cmd
			}
		}
		if m.bulkMode {
			switch msg.String() {
			case "esc":
				m.bulkMode = false
				m.bulkInput.Blur()
				m.bulkInput.SetValue("")
				return m, nil
			case "enter":
				input := strings.TrimSpace(strings.ToLower(m.bulkInput.Value()))
				m.bulkMode = false
				m.bulkInput.Blur()
				m.bulkInput.SetValue("")
				req, err := m.parseBulkRequest(input)
				if err != nil {
					m.err = err.Error()
					return m, nil
				}
				m.pendingBulk = req
				m.confirmMode = true
				m.confirmInput.Focus()
				m.detail = fmt.Sprintf("Confirm bulk %s on %d resources: type yes", req.Action, len(req.Targets))
				return m, textinput.Blink
			default:
				var cmd tea.Cmd
				m.bulkInput, cmd = m.bulkInput.Update(msg)
				return m, cmd
			}
		}
		if m.detailMode {
			return m.updateDetailModeKeys(msg)
		}
		if m.cmdMode {
			switch msg.String() {
			case "esc":
				m.cmdMode = false
				m.cmdInput.Blur()
				m.cmdInput.SetValue("")
				return m, nil
			case "enter":
				input := strings.TrimSpace(m.cmdInput.Value())
				m.cmdMode = false
				m.cmdInput.Blur()
				m.cmdInput.SetValue("")
				if strings.EqualFold(strings.TrimPrefix(input, ":"), "xray") {
					if r, ok := m.currentRow(); ok {
						m.xrayMode = true
						m.xrayLoading = true
						m.xrayErr = ""
						return m, loadXrayCmd(m.opts, m.spec, r)
					}
					return m, nil
				}
				spec, ok := resolveResourceSpec(input)
				if !ok {
					m.err = fmt.Sprintf("unknown resource shortcut %q", input)
					return m, nil
				}
				m.spec = spec
				m.sortColumn = 1
				m.sortDesc = false
				m.selected = 0
				m.detail = ""
				m.err = ""
				m.selectedRows = map[string]bool{}
				m.refreshFiltered()
				return m, loadResourcesCmd(m.opts, m.spec)
			default:
				var cmd tea.Cmd
				m.cmdInput, cmd = m.cmdInput.Update(msg)
				return m, cmd
			}
		}
		if m.filtering {
			switch msg.String() {
			case "esc", "enter":
				m.filtering = false
				m.filterInput.Blur()
				m.refreshFiltered()
				return m, nil
			default:
				var cmd tea.Cmd
				m.filterInput, cmd = m.filterInput.Update(msg)
				m.refreshFiltered()
				return m, cmd
			}
		}
		switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "r":
			return m, loadResourcesCmd(m.opts, m.spec)
		case "up", "k":
			if m.selected > 0 {
				m.selected--
			}
		case "down", "j":
			if m.selected < len(m.filtered)-1 {
				m.selected++
			}
		case "pgdown":
			m.selected = min(len(m.filtered)-1, m.selected+m.pageSize())
			if m.selected < 0 {
				m.selected = 0
			}
		case "pgup":
			m.selected = max(0, m.selected-m.pageSize())
		case "?":
			m.showHelp = true
			return m, nil
		case "/":
			m.filtering = true
			m.filterInput.Focus()
			return m, textinput.Blink
		case " ":
			if r, ok := m.currentRow(); ok {
				k := m.rowKey(r)
				m.selectedRows[k] = !m.selectedRows[k]
				if !m.selectedRows[k] {
					delete(m.selectedRows, k)
				}
			}
		case "ctrl+b":
			targets := m.bulkTargets()
			if len(targets) == 0 {
				m.err = "select resources with Space before bulk operations"
				return m, nil
			}
			m.bulkMode = true
			m.bulkInput.Focus()
			m.bulkInput.SetValue("")
			return m, textinput.Blink
		case "ctrl+s":
			path, err := m.saveSnapshot()
			if err != nil {
				m.err = err.Error()
			} else {
				m.detail = "Saved current view to " + path
				m.err = ""
			}
		case "ctrl+w":
			m.wideMode = !m.wideMode
		case "ctrl+t":
			m.themeIndex = (m.themeIndex + 1) % len(themes)
			applyTheme(m.themeIndex)
		case ":":
			m.cmdMode = true
			m.cmdInput.Focus()
			m.cmdInput.SetValue(":")
			return m, textinput.Blink
		case "ctrl+x":
			if r, ok := m.currentRow(); ok {
				m.xrayMode = true
				m.xrayLoading = true
				m.xrayErr = ""
				return m, loadXrayCmd(m.opts, m.spec, r)
			}
		case "1", "2", "3", "4", "5", "6", "7", "8":
			idx, _ := strconv.Atoi(msg.String())
			m.setSortColumn(idx - 1)
		case "!", "@", "#", "$", "%", "^", "&", "*":
			shiftMap := map[string]int{"!": 0, "@": 1, "#": 2, "$": 3, "%": 4, "^": 5, "&": 6, "*": 7}
			if idx, ok := shiftMap[msg.String()]; ok {
				m.setSortColumn(idx)
				m.sortDesc = true
				m.sortRows()
			}
		case "S":
			m.sortDesc = !m.sortDesc
			m.sortRows()
		case "y":
			if r, ok := m.currentRow(); ok {
				return m, sideDetailCmd(m.opts, m.spec, r, []string{"get", m.spec.KubectlType, r.Name, "-o", "yaml"})
			}
		case "d":
			if r, ok := m.currentRow(); ok {
				return m, sideDetailCmd(m.opts, m.spec, r, []string{"describe", m.spec.KubectlType, r.Name})
			}
		case "l":
			if m.spec.SupportsLogs {
				if r, ok := m.currentRow(); ok {
					return m, sideDetailCmd(m.opts, m.spec, r, []string{"logs", r.Name, "--tail=150"})
				}
			}
		case "A":
			if m.spec.SupportsAI {
				if r, ok := m.currentRow(); ok {
					if !m.aiEnabled || m.opts.AIFunc == nil {
						m.detail = "AI is disabled. Set KCLI_AI_PROVIDER (or provider env vars) to enable."
						return m, nil
					}
					m.detail = "AI analyzing selected resource..."
					target := m.spec.KubectlType + "/" + r.Name
					if r.Namespace != "" && r.Namespace != "-" {
						target = r.Namespace + "/" + target
					}
					return m, aiCmd(m.opts, target)
				}
			}
		case "ctrl+a":
			m.aiEnabled = !m.aiEnabled
			m.opts.AIEnabled = m.aiEnabled
			if !m.aiEnabled {
				m.detail = "AI disabled in TUI (Ctrl+A to enable)"
			} else {
				m.detail = "AI enabled in TUI"
			}
		case "enter":
			if r, ok := m.currentRow(); ok {
				m.enterDetailMode(r)
				return m, loadDetailTabCmd(m.opts, m.spec, r, m.activeTab)
			}
		}
		return m, nil
	case resourcesLoadedMsg:
		if msg.err != nil {
			m.err = msg.err.Error()
			return m, nil
		}
		m.rows = msg.rows
		m.refreshFiltered()
		if m.selected >= len(m.filtered) {
			m.selected = max(0, len(m.filtered)-1)
		}
		if len(m.filtered) > 0 && m.detail == "" {
			m.detail = "Press Enter for detail view. Use d/y for quick panel output; l/A are pod-only."
		}
		m.err = ""
		return m, nil
	case sideDetailLoadedMsg:
		if msg.err != nil {
			m.detail = "Error: " + msg.err.Error()
			return m, nil
		}
		m.detail = msg.detail
		return m, nil
	case detailTabLoadedMsg:
		m.detailLoading = false
		if msg.err != nil {
			m.detailErr = msg.err.Error()
			return m, nil
		}
		m.detailErr = ""
		m.detailCache[msg.tab] = msg.content
		return m, nil
	case xrayLoadedMsg:
		m.xrayLoading = false
		if msg.err != nil {
			m.xrayErr = msg.err.Error()
			m.xrayNodes = nil
			return m, nil
		}
		m.xrayErr = ""
		m.xrayNodes = msg.nodes
		if m.xraySelected >= len(m.xrayNodes) {
			m.xraySelected = max(0, len(m.xrayNodes)-1)
		}
		return m, nil
	case bulkResultMsg:
		if msg.err != nil {
			m.err = msg.err.Error()
			return m, nil
		}
		m.detail = msg.summary
		m.err = ""
		m.selectedRows = map[string]bool{}
		return m, loadResourcesCmd(m.opts, m.spec)
	case editDoneMsg:
		return m, tea.Quit
	}
	return m, nil
}

func (m model) updateDetailModeKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
		case "ctrl+c", "q":
			return m, tea.Quit
		case "?":
			m.showHelp = true
			return m, nil
		case "esc":
			m.detailMode = false
			m.detailLoading = false
			m.detailErr = ""
			return m, nil
		case "r":
		delete(m.detailCache, m.activeTab)
		m.detailLoading = true
		return m, loadDetailTabCmd(m.opts, m.spec, m.detailRow, m.activeTab)
	case "tab", "right", "l", "2":
		return m.switchDetailTab(nextTab(m.activeTab))
	case "shift+tab", "left", "h":
		return m.switchDetailTab(prevTab(m.activeTab))
	case "1":
		return m.switchDetailTab(tabOverview)
	case "3":
		return m.switchDetailTab(tabYAML)
	case "4":
		return m.switchDetailTab(tabAI)
	case "e":
		if m.activeTab == tabYAML {
			return m, editResourceCmd(m.opts, m.spec, m.detailRow)
		}
	case "up", "k":
		if m.detailScrollY > 0 {
			m.detailScrollY--
		}
		return m, nil
	case "down", "j":
		content := m.activeTabContent()
		lines := strings.Split(content, "\n")
		totalLines := len(lines)
		bodyLines := max(12, m.height-4)
		maxScroll := max(0, totalLines-bodyLines)
		if m.detailScrollY < maxScroll {
			m.detailScrollY++
		}
		return m, nil
	case "pgup":
		bodyLines := max(12, m.height-4)
		m.detailScrollY = max(0, m.detailScrollY-bodyLines)
		return m, nil
	case "pgdown":
		content := m.activeTabContent()
		lines := strings.Split(content, "\n")
		totalLines := len(lines)
		bodyLines := max(12, m.height-4)
		maxScroll := max(0, totalLines-bodyLines)
		m.detailScrollY = min(m.detailScrollY+bodyLines, maxScroll)
		return m, nil
	}
	return m, nil
}

func (m model) switchDetailTab(tab detailTab) (tea.Model, tea.Cmd) {
	if m.activeTab == tab {
		return m, nil
	}
	m.activeTab = tab
	m.detailScrollY = 0
	if _, ok := m.detailCache[tab]; ok {
		m.detailLoading = false
		m.detailErr = ""
		return m, nil
	}
	m.detailLoading = true
	m.detailErr = ""
	return m, loadDetailTabCmd(m.opts, m.spec, m.detailRow, tab)
}

func (m *model) enterDetailMode(r resourceRow) {
	m.detailMode = true
	m.detailRow = r
	m.activeTab = tabOverview
	m.detailCache = map[detailTab]string{}
	m.detailErr = ""
	m.detailLoading = true
	m.detailScrollY = 0
}

func (m model) View() string {
	if m.showHelp {
		return m.helpView()
	}
	if m.xrayMode {
		return m.xrayView()
	}
	if m.detailMode {
		return m.detailModeView()
	}
	leftW := max(66, m.width*3/5)
	rightW := max(44, m.width-leftW-2)
	bodyH := max(12, m.height-5)

	header := m.headerView()
	nav := m.navigationView()
	left := paneStyle.Width(leftW).Height(bodyH).Render(m.resourcesView(leftW - 4))
	right := paneStyle.Width(rightW).Height(bodyH).Render(m.detailView())
	body := lipgloss.JoinHorizontal(lipgloss.Top, left, right)
	footer := footerStyle.Width(max(20, m.width)).Render(m.footerView())

	return lipgloss.JoinVertical(lipgloss.Left, header, nav, body, footer)
}

func (m model) detailModeView() string {
	tabs := []string{
		m.renderTab(tabOverview, "Overview"),
		m.renderTab(tabEvents, "Events"),
		m.renderTab(tabYAML, "YAML"),
		m.renderTab(tabAI, "AI Analysis"),
	}
	content := m.activeTabContent()
	target := m.detailRow.Name
	if m.detailRow.Namespace != "" && m.detailRow.Namespace != "-" {
		target = m.detailRow.Namespace + "/" + m.detailRow.Name
	}
	header := headerStyle.Width(max(20, m.width)).Render(fmt.Sprintf("kcli detail | %s %s", m.spec.KubectlType, target))
	tabBar := navStyle.Width(max(20, m.width)).Render(strings.Join(tabs, " "))
	bodyLines := max(12, m.height-4)
	lines := strings.Split(content, "\n")
	totalLines := len(lines)
	start := m.detailScrollY
	if start > totalLines {
		start = max(0, totalLines-bodyLines)
	}
	end := min(start+bodyLines, totalLines)
	visibleContent := strings.Join(lines[start:end], "\n")
	body := paneStyle.Width(max(20, m.width)).Height(bodyLines).Render(visibleContent)
	footerStr := "? help  1 overview 2 events 3 yaml 4 ai  j/k pgup/pgdown scroll  tab switch  r reload  esc back  q quit"
	if m.activeTab == tabYAML {
		footerStr = "? help  1 overview 2 events 3 yaml 4 ai  e edit ($EDITOR)  j/k scroll  tab switch  r reload  esc back  q quit"
	}
	footer := footerStyle.Width(max(20, m.width)).Render(footerStr)
	return lipgloss.JoinVertical(lipgloss.Left, header, tabBar, body, footer)
}

func (m model) xrayView() string {
	header := headerStyle.Width(max(20, m.width)).Render(fmt.Sprintf("kcli xray | %s", m.spec.DisplayName))
	nav := navStyle.Width(max(20, m.width)).Render("j/k navigate  Enter jump to resource  r refresh  Esc back  q quit")
	var b strings.Builder
	if m.xrayLoading {
		b.WriteString("Loading relationship graph...\n")
	}
	if m.xrayErr != "" {
		b.WriteString("Error: " + m.xrayErr + "\n")
	}
	if len(m.xrayNodes) == 0 && !m.xrayLoading && m.xrayErr == "" {
		b.WriteString("(no relationship data)\n")
	}
	for i, n := range m.xrayNodes {
		line := n.Line
		if i == m.xraySelected {
			line = selectedRow.Render(line)
		}
		b.WriteString(line + "\n")
	}
	body := paneStyle.Width(max(20, m.width)).Height(max(12, m.height-4)).Render(strings.TrimSpace(b.String()))
	return lipgloss.JoinVertical(lipgloss.Left, header, nav, body)
}

func (m model) renderTab(tab detailTab, label string) string {
	if m.activeTab == tab {
		return tabActive.Render(label)
	}
	return tabInactive.Render(label)
}

func (m model) activeTabContent() string {
	if m.detailLoading {
		return "Loading..."
	}
	if m.detailErr != "" {
		return "Error: " + m.detailErr
	}
	if out, ok := m.detailCache[m.activeTab]; ok {
		if m.activeTab == tabYAML {
			return highlightYAML(out)
		}
		return out
	}
	return "No data. Press r to retry."
}

func (m model) headerView() string {
	ctx := m.opts.Context
	if strings.TrimSpace(ctx) == "" {
		ctx = "current-context"
	}
	ns := m.opts.Namespace
	if strings.TrimSpace(ns) == "" {
		ns = "all-namespaces"
	}
	ai := "off"
	if m.aiEnabled && (m.opts.AIFunc != nil || m.opts.AIEnabled) {
		ai = "on"
	}
	return headerStyle.Width(max(20, m.width)).Render(fmt.Sprintf("kcli ui | context: %s | namespace: %s | resource: %s | ai: %s", ctx, ns, m.spec.Key, ai))
}

func (m model) navigationView() string {
	parts := []string{m.spec.DisplayName, "Details", fmt.Sprintf("Sort:%s(%s)", m.sortLabel(), ternary(m.sortDesc, "desc", "asc"))}
	if m.filtering {
		parts = append(parts, "Filter: "+m.filterInput.View())
	}
	if m.cmdMode {
		parts = append(parts, "Switch: "+m.cmdInput.View())
	}
	if m.bulkMode {
		parts = append(parts, "Bulk: "+m.bulkInput.View())
	}
	if m.confirmMode {
		parts = append(parts, "Confirm: "+m.confirmInput.View())
	}
	if m.wideMode {
		parts = append(parts, "Wide:on")
	}
	parts = append(parts, fmt.Sprintf("Theme:%s", themes[m.themeIndex].name))
	parts = append(parts, fmt.Sprintf("Selected:%d", len(m.selectedRows)))
	return navStyle.Width(max(20, m.width)).Render(strings.Join(parts, " | "))
}

func (m model) resourcesView(contentWidth int) string {
	var b strings.Builder
	b.WriteString(listTitle.Render(m.spec.DisplayName))
	b.WriteString("\n")
	if m.err != "" {
		b.WriteString("Error loading resources: " + m.err + "\n\n")
	}
	if len(m.filtered) == 0 {
		b.WriteString("  (no resources)\n")
		return b.String()
	}

	widths := m.columnWidths()
	b.WriteString(m.renderRow(m.spec.Headers, widths, -1, contentWidth))
	b.WriteString("\n")

	pageSize := m.pageSize()
	start := (m.selected / pageSize) * pageSize
	end := min(len(m.filtered), start+pageSize)
	statusIdx := columnIndex(m.spec.Headers, "STATUS")
	for i := start; i < end; i++ {
		row := m.filtered[i]
		text := m.renderRow(row.Columns, widths, statusIdx, contentWidth)
		if m.selectedRows[m.rowKey(row)] {
			text = "[*] " + text
		} else {
			text = "[ ] " + text
		}
		if i == m.selected {
			b.WriteString(selectedRow.Render(text))
		} else {
			b.WriteString("  " + text)
		}
		b.WriteString("\n")
	}
	totalPages := max(1, (len(m.filtered)+pageSize-1)/pageSize)
	b.WriteString(fmt.Sprintf("Page %d/%d (%d resources)\n", (m.selected/pageSize)+1, totalPages, len(m.filtered)))
	return b.String()
}

func (m model) detailView() string {
	var b strings.Builder
	b.WriteString(listTitle.Render("Details"))
	b.WriteString("\n")
	if strings.TrimSpace(m.detail) == "" {
		b.WriteString("  (select a resource and press Enter for detail mode)\n")
		return b.String()
	}
	detail := strings.TrimSpace(m.detail)
	if len(detail) > 12000 {
		detail = detail[:12000] + "\n... output truncated ..."
	}
	b.WriteString(detail)
	b.WriteString("\n")
	return b.String()
}

func (m model) footerView() string {
	frame := spinnerFrames[m.frame%len(spinnerFrames)]
	return fmt.Sprintf("[%s] ? help  Space select  Ctrl+B bulk  Ctrl+S save  Ctrl+W wide  Ctrl+T theme  Ctrl+A ai-toggle  :<type> switch  :xray/Ctrl+X graph  / filter  j/k move  1-8 sort  Shift+1..8 desc  Enter detail  d/y/l/A actions  r refresh  q quit", frame)
}

func (m model) helpView() string {
	listShortcuts := "" +
		"  j / k, ↑ / ↓     move selection    pgup / pgdown   page\n" +
		"  Enter            open detail       Esc             (in detail) back\n" +
		"  /                filter list      Space           select row\n" +
		"  Ctrl+B           bulk action       Ctrl+S          save snapshot\n" +
		"  Ctrl+W           wide mode         Ctrl+T          cycle theme\n" +
		"  Ctrl+A           toggle AI        :pods / :deploy  switch resource type\n" +
		"  :xray, Ctrl+X    relationship graph  1–8            sort by column\n" +
		"  Shift+1..8       sort desc         d / y / l       describe / yaml / logs\n" +
		"  A                AI on selection   r               refresh\n" +
		"  q / Ctrl+C       quit\n"
	detailShortcuts := "" +
		"  1 / 2 / 3 / 4    overview / events / yaml / ai    tab / Shift+Tab   switch tab\n" +
		"  j / k, pgup / pgdown   scroll content             e                  edit YAML ($EDITOR)\n" +
		"  r                reload tab         Esc             back to list\n" +
		"  q / Ctrl+C       quit\n"
	body := helpTitle.Render("List view") + "\n" + listShortcuts + "\n" + helpTitle.Render("Detail view") + "\n" + detailShortcuts + "\n  " + footerStyle.Render("Press ? or Esc to close")
	w := min(72, max(50, m.width-4))
	return helpBoxStyle.Width(w).Render(body)
}

func (m model) renderRow(cells []string, widths []int, statusIndex, maxWidth int) string {
	parts := make([]string, 0, len(cells))
	for i, c := range cells {
		w := 12
		if i < len(widths) {
			w = widths[i]
		}
		text := truncate(c, w)
		if i == statusIndex {
			text = statusColor(c, text)
		}
		parts = append(parts, fmt.Sprintf("%-*s", w, text))
	}
	row := strings.Join(parts, " ")
	if lipgloss.Width(row) > maxWidth {
		return truncate(row, maxWidth)
	}
	return row
}

func (m *model) refreshFiltered() {
	raw := strings.TrimSpace(m.filterInput.Value())
	needle := strings.ToLower(raw)
	if needle == "" {
		m.filtered = append([]resourceRow(nil), m.rows...)
	} else {
		out := make([]resourceRow, 0, len(m.rows))
		var rx *regexp.Regexp
		if strings.HasPrefix(needle, "re:") {
			if compiled, err := regexp.Compile(strings.TrimSpace(raw[3:])); err == nil {
				rx = compiled
			}
		} else if strings.HasPrefix(raw, "/") && strings.HasSuffix(raw, "/") && len(raw) > 2 {
			if compiled, err := regexp.Compile(strings.TrimSpace(raw[1 : len(raw)-1])); err == nil {
				rx = compiled
			}
		}
		fieldKey, fieldValue, isField := parseFieldFilter(raw)
		for _, r := range m.rows {
			key := strings.Join(r.Columns, " ")
			lower := strings.ToLower(key)
			matched := false
			switch {
			case rx != nil:
				matched = rx.MatchString(key)
			case isField:
				idx := columnIndex(m.spec.Headers, fieldKey)
				if idx >= 0 {
					matched = strings.Contains(strings.ToLower(valueAt(r.Columns, idx)), strings.ToLower(fieldValue))
				}
			default:
				matched = strings.Contains(lower, needle)
			}
			if matched {
				out = append(out, r)
			}
		}
		m.filtered = out
	}
	m.sortRows()
	if m.selected >= len(m.filtered) {
		m.selected = max(0, len(m.filtered)-1)
	}
}

func (m *model) setSortColumn(col int) {
	if col < 0 || col >= len(m.spec.Headers) {
		return
	}
	if m.sortColumn == col {
		m.sortDesc = !m.sortDesc
	} else {
		m.sortColumn = col
		m.sortDesc = false
	}
	m.sortRows()
}

func (m *model) sortRows() {
	col := m.sortColumn
	sort.SliceStable(m.filtered, func(i, j int) bool {
		a := valueAt(m.filtered[i].Columns, col)
		b := valueAt(m.filtered[j].Columns, col)
		cmp := compareValues(a, b)
		if m.sortDesc {
			return cmp > 0
		}
		return cmp < 0
	})
}

func (m model) sortLabel() string {
	if m.sortColumn < 0 || m.sortColumn >= len(m.spec.Headers) {
		return "n/a"
	}
	return strings.ToLower(m.spec.Headers[m.sortColumn])
}

func (m model) pageSize() int { return max(8, m.height-13) }

func (m model) currentRow() (resourceRow, bool) {
	if len(m.filtered) == 0 || m.selected < 0 || m.selected >= len(m.filtered) {
		return resourceRow{}, false
	}
	return m.filtered[m.selected], true
}

func (m model) rowKey(r resourceRow) string {
	return strings.TrimSpace(r.Namespace) + "/" + strings.TrimSpace(r.Name)
}

func (m model) bulkTargets() []resourceRow {
	if len(m.selectedRows) == 0 {
		if r, ok := m.currentRow(); ok {
			return []resourceRow{r}
		}
		return nil
	}
	out := make([]resourceRow, 0, len(m.selectedRows))
	for _, r := range m.filtered {
		if m.selectedRows[m.rowKey(r)] {
			out = append(out, r)
		}
	}
	return out
}

func (m model) parseBulkRequest(input string) (bulkRequest, error) {
	targets := m.bulkTargets()
	if len(targets) == 0 {
		return bulkRequest{}, fmt.Errorf("no selected resources")
	}
	if input == "delete" {
		return bulkRequest{Action: "delete", Targets: targets}, nil
	}
	if strings.HasPrefix(input, "scale=") {
		if !strings.Contains(strings.ToLower(m.spec.KubectlType), "deploy") {
			return bulkRequest{}, fmt.Errorf("scale bulk action is only supported for deployments view")
		}
		v := strings.TrimSpace(strings.TrimPrefix(input, "scale="))
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return bulkRequest{}, fmt.Errorf("invalid scale value %q", v)
		}
		return bulkRequest{Action: "scale", Replicas: n, Targets: targets}, nil
	}
	return bulkRequest{}, fmt.Errorf("unsupported bulk action %q (use delete or scale=<replicas>)", input)
}

func runBulkCmd(opts Options, spec resourceSpec, req bulkRequest) tea.Cmd {
	return func() tea.Msg {
		if len(req.Targets) == 0 {
			return bulkResultMsg{err: fmt.Errorf("no bulk targets selected")}
		}
		done := 0
		for _, t := range req.Targets {
			var args []string
			switch req.Action {
			case "delete":
				args = []string{"delete", spec.KubectlType, t.Name}
			case "scale":
				args = []string{"scale", spec.KubectlType, t.Name, fmt.Sprintf("--replicas=%d", req.Replicas)}
			default:
				return bulkResultMsg{err: fmt.Errorf("unknown bulk action %q", req.Action)}
			}
			if spec.Namespaced && t.Namespace != "" && t.Namespace != "-" {
				args = append(args, "-n", t.Namespace)
			}
			if _, err := runKubectl(opts, args); err != nil {
				return bulkResultMsg{err: err}
			}
			done++
		}
		switch req.Action {
		case "scale":
			return bulkResultMsg{summary: fmt.Sprintf("Scaled %d %s to %d replicas.", done, spec.KubectlType, req.Replicas)}
		default:
			return bulkResultMsg{summary: fmt.Sprintf("Deleted %d %s.", done, spec.KubectlType)}
		}
	}
}

func (m model) saveSnapshot() (string, error) {
	base := fmt.Sprintf("kcli-ui-%s-%s.txt", m.spec.Key, time.Now().Format("20060102-150405"))
	path := filepath.Join(os.TempDir(), base)
	var b strings.Builder
	b.WriteString(fmt.Sprintf("resource=%s context=%s namespace=%s selected=%d\n", m.spec.Key, m.opts.Context, m.opts.Namespace, len(m.selectedRows)))
	b.WriteString(strings.Join(m.spec.Headers, "\t") + "\n")
	for _, r := range m.filtered {
		prefix := " "
		if m.selectedRows[m.rowKey(r)] {
			prefix = "*"
		}
		b.WriteString(prefix + "\t" + strings.Join(r.Columns, "\t") + "\n")
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (m model) columnWidths() []int {
	widths := append([]int(nil), m.spec.Widths...)
	if !m.wideMode {
		return widths
	}
	for i := range widths {
		widths[i] += max(2, widths[i]/3)
	}
	return widths
}

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second/60, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func refreshTickCmdFn(interval time.Duration) tea.Cmd {
	if interval <= 0 {
		interval = 2 * time.Second
	}
	return tea.Tick(interval, func(t time.Time) tea.Msg { return refreshTickMsg(t) })
}

func loadResourcesCmd(opts Options, spec resourceSpec) tea.Cmd {
	return func() tea.Msg {
		args := []string{"get", spec.KubectlType, "--no-headers"}
		if spec.Namespaced {
			if opts.Namespace != "" {
				args = append(args, "-n", opts.Namespace)
			} else {
				args = append(args, "-A")
			}
		}
		out, err := runKubectl(opts, args)
		if err != nil {
			return resourcesLoadedMsg{err: err}
		}
		rows := parseRows(out, opts.Namespace, spec)
		return resourcesLoadedMsg{rows: rows}
	}
}

func parseRows(out, scopedNamespace string, spec resourceSpec) []resourceRow {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	rows := make([]resourceRow, 0, len(lines))
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		r, ok := spec.ParseLine(ln, scopedNamespace)
		if ok {
			rows = append(rows, r)
		}
	}
	return rows
}

func sideDetailCmd(opts Options, spec resourceSpec, row resourceRow, args []string) tea.Cmd {
	return func() tea.Msg {
		full := append([]string{}, args...)
		if spec.Namespaced && row.Namespace != "" && row.Namespace != "-" && !hasNamespaceArg(full) {
			full = append(full, "-n", row.Namespace)
		}
		out, err := runKubectl(opts, full)
		if err != nil {
			return sideDetailLoadedMsg{err: err}
		}
		return sideDetailLoadedMsg{detail: out}
	}
}

func loadDetailTabCmd(opts Options, spec resourceSpec, row resourceRow, tab detailTab) tea.Cmd {
	return func() tea.Msg {
		var (
			out  string
			err  error
			args []string
		)
		switch tab {
		case tabEvents:
			if strings.EqualFold(spec.Kind, "Event") {
				return detailTabLoadedMsg{tab: tab, content: "Events list view does not have nested related events."}
			}
			args = []string{"get", "events", "--field-selector", "involvedObject.kind=" + spec.Kind + ",involvedObject.name=" + row.Name, "--sort-by=.lastTimestamp"}
			if spec.Namespaced && row.Namespace != "" && row.Namespace != "-" {
				args = append(args, "-n", row.Namespace)
			} else {
				args = append(args, "-A")
			}
		case tabYAML:
			args = []string{"get", spec.KubectlType, row.Name, "-o", "yaml"}
			if spec.Namespaced && row.Namespace != "" && row.Namespace != "-" {
				args = append(args, "-n", row.Namespace)
			}
		case tabAI:
			if opts.AIFunc == nil || !opts.AIEnabled {
				return detailTabLoadedMsg{tab: tab, content: "AI is disabled for this session."}
			}
			target := spec.KubectlType + "/" + row.Name
			if row.Namespace != "" && row.Namespace != "-" {
				target = row.Namespace + "/" + target
			}
			out, err = opts.AIFunc(target)
			if err != nil {
				return detailTabLoadedMsg{tab: tab, err: err}
			}
			return detailTabLoadedMsg{tab: tab, content: out}
		default:
			args = []string{"describe", spec.KubectlType, row.Name}
			if spec.Namespaced && row.Namespace != "" && row.Namespace != "-" {
				args = append(args, "-n", row.Namespace)
			}
		}
		out, err = runKubectl(opts, args)
		if err != nil {
			return detailTabLoadedMsg{tab: tab, err: err}
		}
		return detailTabLoadedMsg{tab: tab, content: out}
	}
}

func aiCmd(opts Options, target string) tea.Cmd {
	return func() tea.Msg {
		if opts.AIFunc == nil {
			return sideDetailLoadedMsg{detail: "AI is disabled. Set KCLI_AI_PROVIDER (or provider env vars) to enable."}
		}
		res, err := opts.AIFunc(target)
		if err != nil {
			return sideDetailLoadedMsg{err: err}
		}
		return sideDetailLoadedMsg{detail: res}
	}
}

func runKubectl(opts Options, args []string) (string, error) {
	full := make([]string, 0, len(args)+4)
	if opts.Kubeconfig != "" {
		full = append(full, "--kubeconfig", opts.Kubeconfig)
	}
	if opts.Context != "" {
		full = append(full, "--context", opts.Context)
	}
	full = append(full, args...)
	cmd := exec.Command("kubectl", full...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%w\n%s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// editResourceCmd runs kubectl edit for the current detail resource and returns editDoneMsg.
// It leaves the alternate screen so the editor uses the main buffer, then runs kubectl edit
// with stdin/stdout/stderr attached (opens $EDITOR). When the editor exits, kcli quits.
func editResourceCmd(opts Options, spec resourceSpec, row resourceRow) tea.Cmd {
	return func() tea.Msg {
		args := []string{"edit", spec.KubectlType, row.Name}
		if spec.Namespaced && row.Namespace != "" && row.Namespace != "-" {
			args = append(args, "-n", row.Namespace)
		}
		full := make([]string, 0, len(args)+4)
		if opts.Kubeconfig != "" {
			full = append(full, "--kubeconfig", opts.Kubeconfig)
		}
		if opts.Context != "" {
			full = append(full, "--context", opts.Context)
		}
		full = append(full, args...)
		cmd := exec.Command("kubectl", full...)
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		// Leave alternate screen so the editor draws on the main buffer
		_, _ = os.Stdout.Write([]byte("\033[?1049l"))
		_ = cmd.Run()
		return editDoneMsg{}
	}
}

func defaultResourceSpec() resourceSpec {
	s, _ := resolveResourceSpec(":pods")
	return s
}

func resolveResourceSpec(input string) (resourceSpec, bool) {
	key := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(input)), ":")
	for _, s := range resourceSpecs() {
		if key == s.Key {
			return s, true
		}
		for _, a := range s.Aliases {
			if key == a {
				return s, true
			}
		}
	}
	return resourceSpec{}, false
}

func resourceSpecs() []resourceSpec {
	return []resourceSpec{
		{Key: "pods", Aliases: []string{"po"}, DisplayName: "Pods", Kind: "Pod", KubectlType: "pods", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "READY", "STATUS", "RESTARTS", "AGE", "NODE"}, Widths: []int{16, 28, 7, 12, 9, 7, 18}, SupportsLogs: true, SupportsAI: true, ParseLine: parsePodsLine},
		{Key: "deploy", Aliases: []string{"deployment", "deployments"}, DisplayName: "Deployments", Kind: "Deployment", KubectlType: "deployments", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"}, Widths: []int{16, 32, 10, 12, 10, 8}, ParseLine: parseDeploymentsLine},
		{Key: "svc", Aliases: []string{"service", "services"}, DisplayName: "Services", Kind: "Service", KubectlType: "services", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "TYPE", "CLUSTER-IP", "PORT(S)", "AGE"}, Widths: []int{16, 28, 12, 16, 16, 8}, ParseLine: parseServicesLine},
		{Key: "nodes", Aliases: []string{"node"}, DisplayName: "Nodes", Kind: "Node", KubectlType: "nodes", Namespaced: false, Headers: []string{"NAME", "STATUS", "ROLES", "AGE", "VERSION"}, Widths: []int{28, 12, 16, 8, 12}, ParseLine: parseNodesLine},
		{Key: "events", Aliases: []string{"ev"}, DisplayName: "Events", Kind: "Event", KubectlType: "events", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "TYPE", "REASON", "OBJECT", "AGE"}, Widths: []int{16, 30, 10, 20, 24, 8}, ParseLine: parseEventsLine},
		{Key: "ns", Aliases: []string{"namespaces", "namespace"}, DisplayName: "Namespaces", Kind: "Namespace", KubectlType: "namespaces", Namespaced: false, Headers: []string{"NAME", "STATUS", "AGE"}, Widths: []int{28, 12, 8}, ParseLine: parseNamespacesLine},
		{Key: "ing", Aliases: []string{"ingress", "ingresses"}, DisplayName: "Ingresses", Kind: "Ingress", KubectlType: "ingresses", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"}, Widths: []int{16, 26, 12, 22, 20, 8, 8}, ParseLine: parseIngressesLine},
		{Key: "cm", Aliases: []string{"configmap", "configmaps"}, DisplayName: "ConfigMaps", Kind: "ConfigMap", KubectlType: "configmaps", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "DATA", "AGE"}, Widths: []int{16, 36, 8, 8}, ParseLine: parseConfigMapsLine},
		{Key: "secrets", Aliases: []string{"secret"}, DisplayName: "Secrets", Kind: "Secret", KubectlType: "secrets", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "TYPE", "DATA", "AGE"}, Widths: []int{16, 30, 20, 8, 8}, ParseLine: parseSecretsLine},
		{Key: "pvc", Aliases: []string{"pvcs", "persistentvolumeclaims"}, DisplayName: "PVCs", Kind: "PersistentVolumeClaim", KubectlType: "pvc", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "AGE"}, Widths: []int{16, 22, 10, 18, 10, 14, 8}, ParseLine: parsePVCLine},
		{Key: "jobs", Aliases: []string{"job"}, DisplayName: "Jobs", Kind: "Job", KubectlType: "jobs", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "COMPLETIONS", "DURATION", "AGE"}, Widths: []int{16, 28, 14, 12, 8}, ParseLine: parseJobsLine},
		{Key: "cronjobs", Aliases: []string{"cj", "cronjob"}, DisplayName: "CronJobs", Kind: "CronJob", KubectlType: "cronjobs", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "SCHEDULE", "SUSPEND", "ACTIVE", "LAST SCHEDULE", "AGE"}, Widths: []int{16, 28, 18, 8, 8, 18, 8}, ParseLine: parseCronJobsLine},
		{Key: "rs", Aliases: []string{"replicaset", "replicasets"}, DisplayName: "ReplicaSets", Kind: "ReplicaSet", KubectlType: "replicasets", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "DESIRED", "CURRENT", "READY", "AGE"}, Widths: []int{16, 30, 10, 10, 10, 8}, ParseLine: parseReplicaSetsLine},
		{Key: "ep", Aliases: []string{"endpoint", "endpoints"}, DisplayName: "Endpoints", Kind: "Endpoints", KubectlType: "endpoints", Namespaced: true, Headers: []string{"NAMESPACE", "NAME", "ENDPOINTS", "AGE"}, Widths: []int{16, 30, 40, 8}, ParseLine: parseEndpointsLine},
	}
}

func parsePodsLine(line, scopedNamespace string) (resourceRow, bool) {
	fields := strings.Fields(line)
	if scopedNamespace == "" {
		if len(fields) < 8 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: fields[0], Name: fields[1], Columns: []string{fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[7]}}, true
	}
	if len(fields) < 7 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: fields[0], Columns: []string{scopedNamespace, fields[0], fields[1], fields[2], fields[3], fields[4], fields[6]}}, true
}

func parseDeploymentsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 6 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[4], f[5]}}, true
	}
	if len(f) < 5 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[3], f[4]}}, true
}

func parseServicesLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 7 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[5], f[6]}}, true
	}
	if len(f) < 6 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[4], f[5]}}, true
}

func parseNodesLine(line, _ string) (resourceRow, bool) {
	f := strings.Fields(line)
	if len(f) < 5 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: "-", Name: f[0], Columns: []string{f[0], f[1], f[2], f[3], f[4]}}, true
}

func parseEventsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 5 {
			return resourceRow{}, false
		}
		obj := f[len(f)-2]
		reason := f[len(f)-3]
		typ := f[len(f)-4]
		age := f[1]
		name := f[0] + "/" + reason
		return resourceRow{Namespace: f[0], Name: name, Columns: []string{f[0], name, typ, reason, obj, age}}, true
	}
	if len(f) < 4 {
		return resourceRow{}, false
	}
	obj := f[len(f)-2]
	reason := f[len(f)-3]
	typ := f[len(f)-4]
	age := f[0]
	name := scopedNamespace + "/" + reason
	return resourceRow{Namespace: scopedNamespace, Name: name, Columns: []string{scopedNamespace, name, typ, reason, obj, age}}, true
}

func parseNamespacesLine(line, _ string) (resourceRow, bool) {
	f := strings.Fields(line)
	if len(f) < 3 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: "-", Name: f[0], Columns: []string{f[0], f[1], f[2]}}, true
}

func parseIngressesLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 7 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[4], f[5], f[6]}}, true
	}
	if len(f) < 6 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[3], f[4], f[5]}}, true
}

func parseConfigMapsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 4 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3]}}, true
	}
	if len(f) < 3 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2]}}, true
}

func parseSecretsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 5 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[4]}}, true
	}
	if len(f) < 4 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[3]}}, true
}

func parsePVCLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 8 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[4], f[5], f[len(f)-1]}}, true
	}
	if len(f) < 7 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[3], f[4], f[len(f)-1]}}, true
}

func parseJobsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 5 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[4]}}, true
	}
	if len(f) < 4 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[3]}}, true
}

func parseCronJobsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 7 {
			return resourceRow{}, false
		}
		last := f[len(f)-2]
		age := f[len(f)-1]
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[4], f[5], last, age}}, true
	}
	if len(f) < 6 {
		return resourceRow{}, false
	}
	last := f[len(f)-2]
	age := f[len(f)-1]
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[3], f[4], last, age}}, true
}

func parseReplicaSetsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 6 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3], f[4], f[5]}}, true
	}
	if len(f) < 5 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2], f[3], f[4]}}, true
}

func parseEndpointsLine(line, scopedNamespace string) (resourceRow, bool) {
	f := strings.Fields(line)
	if scopedNamespace == "" {
		if len(f) < 4 {
			return resourceRow{}, false
		}
		return resourceRow{Namespace: f[0], Name: f[1], Columns: []string{f[0], f[1], f[2], f[3]}}, true
	}
	if len(f) < 3 {
		return resourceRow{}, false
	}
	return resourceRow{Namespace: scopedNamespace, Name: f[0], Columns: []string{scopedNamespace, f[0], f[1], f[2]}}, true
}

func specForKind(kind string) (resourceSpec, bool) {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "deployment":
		return resolveResourceSpec("deploy")
	case "replicaset":
		return resolveResourceSpec("rs")
	case "pod":
		return resolveResourceSpec("pods")
	case "service":
		return resolveResourceSpec("svc")
	case "ingress":
		return resolveResourceSpec("ing")
	case "endpoints", "endpoint":
		return resolveResourceSpec("ep")
	case "namespace":
		return resolveResourceSpec("ns")
	case "node":
		return resolveResourceSpec("nodes")
	case "configmap":
		return resolveResourceSpec("cm")
	case "secret":
		return resolveResourceSpec("secrets")
	case "persistentvolumeclaim":
		return resolveResourceSpec("pvc")
	case "job":
		return resolveResourceSpec("jobs")
	case "cronjob":
		return resolveResourceSpec("cronjobs")
	default:
		return resourceSpec{}, false
	}
}

func loadXrayCmd(opts Options, spec resourceSpec, row resourceRow) tea.Cmd {
	return func() tea.Msg {
		root, err := buildXray(opts, spec, row)
		if err != nil {
			return xrayLoadedMsg{err: err}
		}
		nodes := flattenXray(root)
		return xrayLoadedMsg{nodes: nodes}
	}
}

func buildXray(opts Options, spec resourceSpec, row resourceRow) (*xrayNode, error) {
	root := &xrayNode{Kind: spec.Kind, Namespace: row.Namespace, Name: row.Name}
	switch strings.ToLower(spec.Kind) {
	case "deployment":
		selector, err := deploymentSelector(opts, row.Namespace, row.Name)
		if err != nil {
			return nil, err
		}
		rs, _ := listBySelector(opts, "replicasets", row.Namespace, selector)
		pods, _ := listBySelector(opts, "pods", row.Namespace, selector)
		services, _ := servicesMatchingLabels(opts, row.Namespace, selector)
		for _, name := range rs {
			root.Children = append(root.Children, &xrayNode{Kind: "ReplicaSet", Namespace: row.Namespace, Name: name})
		}
		for _, name := range pods {
			root.Children = append(root.Children, &xrayNode{Kind: "Pod", Namespace: row.Namespace, Name: name})
		}
		for _, svc := range services {
			snode := &xrayNode{Kind: "Service", Namespace: row.Namespace, Name: svc}
			ings, _ := ingressesForService(opts, row.Namespace, svc)
			for _, ing := range ings {
				snode.Children = append(snode.Children, &xrayNode{Kind: "Ingress", Namespace: row.Namespace, Name: ing})
			}
			if exists, _ := resourceExists(opts, "endpoints", row.Namespace, svc); exists {
				snode.Children = append(snode.Children, &xrayNode{Kind: "Endpoints", Namespace: row.Namespace, Name: svc})
			}
			root.Children = append(root.Children, snode)
		}
	case "service":
		selector, err := serviceSelector(opts, row.Namespace, row.Name)
		if err != nil {
			return nil, err
		}
		pods, _ := listBySelector(opts, "pods", row.Namespace, selector)
		deps, _ := deploymentsMatchingLabels(opts, row.Namespace, selector)
		for _, name := range deps {
			root.Children = append(root.Children, &xrayNode{Kind: "Deployment", Namespace: row.Namespace, Name: name})
		}
		for _, name := range pods {
			root.Children = append(root.Children, &xrayNode{Kind: "Pod", Namespace: row.Namespace, Name: name})
		}
		ings, _ := ingressesForService(opts, row.Namespace, row.Name)
		for _, ing := range ings {
			root.Children = append(root.Children, &xrayNode{Kind: "Ingress", Namespace: row.Namespace, Name: ing})
		}
		if exists, _ := resourceExists(opts, "endpoints", row.Namespace, row.Name); exists {
			root.Children = append(root.Children, &xrayNode{Kind: "Endpoints", Namespace: row.Namespace, Name: row.Name})
		}
	case "pod":
		labels, ownerKind, ownerName, err := podLabelsOwner(opts, row.Namespace, row.Name)
		if err != nil {
			return nil, err
		}
		if ownerKind != "" && ownerName != "" {
			root.Children = append(root.Children, &xrayNode{Kind: ownerKind, Namespace: row.Namespace, Name: ownerName})
			if strings.EqualFold(ownerKind, "ReplicaSet") {
				if depKind, depName, err := replicasetOwner(opts, row.Namespace, ownerName); err == nil && depName != "" {
					root.Children = append(root.Children, &xrayNode{Kind: depKind, Namespace: row.Namespace, Name: depName})
				}
			}
		}
		services, _ := servicesMatchingLabels(opts, row.Namespace, labels)
		for _, svc := range services {
			snode := &xrayNode{Kind: "Service", Namespace: row.Namespace, Name: svc}
			ings, _ := ingressesForService(opts, row.Namespace, svc)
			for _, ing := range ings {
				snode.Children = append(snode.Children, &xrayNode{Kind: "Ingress", Namespace: row.Namespace, Name: ing})
			}
			root.Children = append(root.Children, snode)
		}
	default:
		root.Children = append(root.Children, &xrayNode{Kind: "Info", Name: "No xray relationship mapping for " + spec.Kind})
	}
	return root, nil
}

func flattenXray(root *xrayNode) []xrayDisplayNode {
	if root == nil {
		return nil
	}
	out := make([]xrayDisplayNode, 0, 16)
	var walk func(n *xrayNode, prefix string, isLast bool, isRoot bool)
	walk = func(n *xrayNode, prefix string, isLast bool, isRoot bool) {
		if n == nil {
			return
		}
		line := ""
		if isRoot {
			line = fmt.Sprintf("%s: %s", n.Kind, n.nameRef())
		} else {
			branch := "├── "
			nextPrefix := prefix + "│   "
			if isLast {
				branch = "└── "
				nextPrefix = prefix + "    "
			}
			line = prefix + branch + fmt.Sprintf("%s: %s", n.Kind, n.nameRef())
			prefix = nextPrefix
		}
		out = append(out, xrayDisplayNode{Kind: n.Kind, Namespace: n.Namespace, Name: n.Name, Line: line})
		for i, c := range n.Children {
			walk(c, prefix, i == len(n.Children)-1, false)
		}
	}
	walk(root, "", true, true)
	return out
}

func (n *xrayNode) nameRef() string {
	if n.Namespace != "" && n.Namespace != "-" {
		return n.Namespace + "/" + n.Name
	}
	return n.Name
}

func deploymentSelector(opts Options, namespace, name string) (map[string]string, error) {
	out, err := runKubectl(opts, []string{"get", "deployment", name, "-n", namespace, "-o", "json"})
	if err != nil {
		return nil, err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return nil, err
	}
	return nestedStringMap(obj, "spec", "selector", "matchLabels"), nil
}

func serviceSelector(opts Options, namespace, name string) (map[string]string, error) {
	out, err := runKubectl(opts, []string{"get", "service", name, "-n", namespace, "-o", "json"})
	if err != nil {
		return nil, err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return nil, err
	}
	return nestedStringMap(obj, "spec", "selector"), nil
}

func listBySelector(opts Options, resource, namespace string, labels map[string]string) ([]string, error) {
	selector := labelsToSelector(labels)
	if selector == "" {
		return nil, nil
	}
	args := []string{"get", resource, "-n", namespace, "-l", selector, "-o", "jsonpath={range .items[*]}{.metadata.name}{\"\\n\"}{end}"}
	out, err := runKubectl(opts, args)
	if err != nil {
		return nil, err
	}
	return splitLines(out), nil
}

func servicesMatchingLabels(opts Options, namespace string, labels map[string]string) ([]string, error) {
	out, err := runKubectl(opts, []string{"get", "services", "-n", namespace, "-o", "json"})
	if err != nil {
		return nil, err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return nil, err
	}
	items := nestedSlice(obj, "items")
	outNames := make([]string, 0, len(items))
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		sel := nestedStringMap(m, "spec", "selector")
		if len(sel) == 0 {
			continue
		}
		if selectorMatches(sel, labels) {
			name := nestedString(m, "metadata", "name")
			if name != "" {
				outNames = append(outNames, name)
			}
		}
	}
	sort.Strings(outNames)
	return outNames, nil
}

func deploymentsMatchingLabels(opts Options, namespace string, labels map[string]string) ([]string, error) {
	out, err := runKubectl(opts, []string{"get", "deployments", "-n", namespace, "-o", "json"})
	if err != nil {
		return nil, err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return nil, err
	}
	items := nestedSlice(obj, "items")
	outNames := make([]string, 0, len(items))
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		sel := nestedStringMap(m, "spec", "selector", "matchLabels")
		if len(sel) == 0 {
			continue
		}
		if selectorMatches(sel, labels) {
			name := nestedString(m, "metadata", "name")
			if name != "" {
				outNames = append(outNames, name)
			}
		}
	}
	sort.Strings(outNames)
	return outNames, nil
}

func ingressesForService(opts Options, namespace, serviceName string) ([]string, error) {
	out, err := runKubectl(opts, []string{"get", "ingresses", "-n", namespace, "-o", "json"})
	if err != nil {
		return nil, err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return nil, err
	}
	items := nestedSlice(obj, "items")
	outNames := make([]string, 0, len(items))
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		if ingressRefsService(m, serviceName) {
			name := nestedString(m, "metadata", "name")
			if name != "" {
				outNames = append(outNames, name)
			}
		}
	}
	sort.Strings(outNames)
	return outNames, nil
}

func ingressRefsService(obj map[string]any, serviceName string) bool {
	rules := nestedSlice(obj, "spec", "rules")
	for _, rv := range rules {
		r, ok := rv.(map[string]any)
		if !ok {
			continue
		}
		paths := nestedSlice(r, "http", "paths")
		for _, pv := range paths {
			p, ok := pv.(map[string]any)
			if !ok {
				continue
			}
			if nestedString(p, "backend", "service", "name") == serviceName {
				return true
			}
		}
	}
	defaultBackend := nestedMap(obj, "spec", "defaultBackend")
	if len(defaultBackend) > 0 && nestedString(defaultBackend, "service", "name") == serviceName {
		return true
	}
	return false
}

func resourceExists(opts Options, resource, namespace, name string) (bool, error) {
	args := []string{"get", resource, name}
	if namespace != "" && namespace != "-" {
		args = append(args, "-n", namespace)
	}
	_, err := runKubectl(opts, args)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "notfound") || strings.Contains(strings.ToLower(err.Error()), "not found") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func podLabelsOwner(opts Options, namespace, name string) (labels map[string]string, ownerKind, ownerName string, err error) {
	out, err := runKubectl(opts, []string{"get", "pod", name, "-n", namespace, "-o", "json"})
	if err != nil {
		return nil, "", "", err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return nil, "", "", err
	}
	labels = nestedStringMap(obj, "metadata", "labels")
	owners := nestedSlice(obj, "metadata", "ownerReferences")
	for _, ov := range owners {
		om, ok := ov.(map[string]any)
		if !ok {
			continue
		}
		if boolValue(om["controller"]) {
			return labels, stringValue(om["kind"]), stringValue(om["name"]), nil
		}
	}
	return labels, "", "", nil
}

func replicasetOwner(opts Options, namespace, name string) (kind, ownerName string, err error) {
	out, err := runKubectl(opts, []string{"get", "replicaset", name, "-n", namespace, "-o", "json"})
	if err != nil {
		return "", "", err
	}
	obj, err := decodeJSONObj(out)
	if err != nil {
		return "", "", err
	}
	owners := nestedSlice(obj, "metadata", "ownerReferences")
	for _, ov := range owners {
		om, ok := ov.(map[string]any)
		if !ok {
			continue
		}
		if boolValue(om["controller"]) {
			return stringValue(om["kind"]), stringValue(om["name"]), nil
		}
	}
	return "", "", nil
}

func labelsToSelector(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+labels[k])
	}
	return strings.Join(parts, ",")
}

func selectorMatches(selector, labels map[string]string) bool {
	if len(selector) == 0 || len(labels) == 0 {
		return false
	}
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

func decodeJSONObj(s string) (map[string]any, error) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(s), &obj); err != nil {
		return nil, err
	}
	return obj, nil
}

func splitLines(s string) []string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			out = append(out, l)
		}
	}
	sort.Strings(out)
	return out
}

func nestedMap(m map[string]any, path ...string) map[string]any {
	cur := any(m)
	for _, p := range path {
		mm, ok := cur.(map[string]any)
		if !ok {
			return map[string]any{}
		}
		cur, ok = mm[p]
		if !ok {
			return map[string]any{}
		}
	}
	if out, ok := cur.(map[string]any); ok {
		return out
	}
	return map[string]any{}
}

func nestedSlice(m map[string]any, path ...string) []any {
	cur := any(m)
	for _, p := range path {
		mm, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur, ok = mm[p]
		if !ok {
			return nil
		}
	}
	if out, ok := cur.([]any); ok {
		return out
	}
	return nil
}

func nestedStringMap(m map[string]any, path ...string) map[string]string {
	raw := nestedMap(m, path...)
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		out[k] = stringValue(v)
	}
	return out
}

func nestedString(m map[string]any, path ...string) string {
	cur := any(m)
	for _, p := range path {
		mm, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur, ok = mm[p]
		if !ok {
			return ""
		}
	}
	return stringValue(cur)
}

func stringValue(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case fmt.Stringer:
		return strings.TrimSpace(t.String())
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", t))
	}
}

func boolValue(v any) bool {
	b, ok := v.(bool)
	return ok && b
}

func hasNamespaceArg(args []string) bool {
	for i := 0; i < len(args); i++ {
		a := strings.TrimSpace(args[i])
		if a == "-n" || a == "--namespace" || strings.HasPrefix(a, "--namespace=") {
			return true
		}
	}
	return false
}

func valueAt(values []string, idx int) string {
	if idx < 0 || idx >= len(values) {
		return ""
	}
	return strings.TrimSpace(values[idx])
}

func compareValues(a, b string) int {
	if ai, aerr := strconv.ParseFloat(a, 64); aerr == nil {
		if bi, berr := strconv.ParseFloat(b, 64); berr == nil {
			switch {
			case ai < bi:
				return -1
			case ai > bi:
				return 1
			default:
				return 0
			}
		}
	}
	al := strings.ToLower(a)
	bl := strings.ToLower(b)
	switch {
	case al < bl:
		return -1
	case al > bl:
		return 1
	default:
		return 0
	}
}

func columnIndex(headers []string, key string) int {
	for i, h := range headers {
		if strings.EqualFold(strings.TrimSpace(h), key) {
			return i
		}
	}
	return -1
}

func parseFieldFilter(input string) (field, value string, ok bool) {
	s := strings.TrimSpace(input)
	if s == "" || !strings.Contains(s, ":") {
		return "", "", false
	}
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	field = strings.ToUpper(strings.TrimSpace(parts[0]))
	value = strings.TrimSpace(parts[1])
	if field == "" || value == "" {
		return "", "", false
	}
	switch field {
	case "NS":
		field = "NAMESPACE"
	case "NAME":
		field = "NAME"
	case "STATUS":
		field = "STATUS"
	case "TYPE":
		field = "TYPE"
	case "NODE":
		field = "NODE"
	case "AGE":
		field = "AGE"
	}
	return field, value, true
}

func statusColor(status, text string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "running", "succeeded", "completed", "active", "bound", "ready", "true":
		return runningStyle.Render(text)
	case "pending", "containercreating", "init", "unknown":
		return pendingStyle.Render(text)
	case "failed", "error", "crashloopbackoff", "imagepullbackoff", "errimagepull", "false", "notready":
		return failedStyle.Render(text)
	default:
		return text
	}
}

func applyTheme(idx int) {
	if idx < 0 || idx >= len(themes) {
		return
	}
	t := themes[idx]
	headerStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("229")).Background(lipgloss.Color(t.head)).Padding(0, 1)
	navStyle = lipgloss.NewStyle().Foreground(lipgloss.Color(t.nav)).Padding(0, 1)
	selectedRow = lipgloss.NewStyle().Foreground(lipgloss.Color("229")).Background(lipgloss.Color(t.sel)).Padding(0, 1)
}

func themeIndexByName(name string) int {
	name = strings.ToLower(strings.TrimSpace(name))
	for i, t := range themes {
		if strings.ToLower(strings.TrimSpace(t.name)) == name {
			return i
		}
	}
	return 0
}

func highlightYAML(raw string) string {
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		trimmed := strings.TrimLeft(line, " ")
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "-") {
			continue
		}
		idx := strings.Index(trimmed, ":")
		if idx <= 0 {
			continue
		}
		prefixSpaces := line[:len(line)-len(trimmed)]
		key := trimmed[:idx]
		rest := trimmed[idx:]
		lines[i] = prefixSpaces + yamlKeyStyle.Render(key) + rest
	}
	return strings.Join(lines, "\n")
}

func truncate(s string, maxLen int) string {
	if maxLen <= 0 || len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

func nextTab(t detailTab) detailTab {
	switch t {
	case tabOverview:
		return tabEvents
	case tabEvents:
		return tabYAML
	case tabYAML:
		return tabAI
	default:
		return tabOverview
	}
}

func prevTab(t detailTab) detailTab {
	switch t {
	case tabAI:
		return tabYAML
	case tabYAML:
		return tabEvents
	case tabEvents:
		return tabOverview
	default:
		return tabAI
	}
}

func ternary(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}

func runProgramForTest(opts Options, input io.Reader, output io.Writer, extra ...tea.ProgramOption) error {
	programOptions := []tea.ProgramOption{tea.WithInput(input), tea.WithOutput(output), tea.WithoutRenderer()}
	programOptions = append(programOptions, extra...)
	return runProgram(opts, programOptions...)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
