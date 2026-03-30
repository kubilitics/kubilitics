package topologyexport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	nodeWidth  = 120
	nodeHeight = 40
	gridGapX   = 180
	gridGapY   = 60
)

// ApplySimpleLayout assigns grid positions to nodes that don't have Position set.
func ApplySimpleLayout(g *models.TopologyGraph) {
	if g == nil {
		return
	}
	nodeIDs := make(map[string]int)
	for i, n := range g.Nodes {
		nodeIDs[n.ID] = i
	}
	// Grid: roughly sqrt(n) columns
	n := len(g.Nodes)
	cols := int(math.Ceil(math.Sqrt(float64(n))))
	if cols < 1 {
		cols = 1
	}
	for i := range g.Nodes {
		if g.Nodes[i].Position != nil {
			continue
		}
		row := i / cols
		col := i % cols
		x := float64(col)*gridGapX + 20
		y := float64(row)*gridGapY + 20
		g.Nodes[i].Position = &models.Position{X: x, Y: y}
	}
}

// GraphToJSON returns the topology graph as JSON bytes.
func GraphToJSON(g *models.TopologyGraph) ([]byte, error) {
	if g == nil {
		return []byte("null"), nil
	}
	return json.MarshalIndent(g, "", "  ")
}

// GraphToSVG returns an SVG document representing the topology graph.
func GraphToSVG(g *models.TopologyGraph) ([]byte, error) {
	if g == nil || len(g.Nodes) == 0 {
		return []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><text x="20" y="50" font-size="14">No resources</text></svg>`), nil
	}
	ApplySimpleLayout(g)
	// Bounds
	minX, minY := 1e9, 1e9
	maxX, maxY := -1e9, -1e9
	for _, n := range g.Nodes {
		if n.Position == nil {
			continue
		}
		x, y := n.Position.X, n.Position.Y
		if x < minX {
			minX = x
		}
		if y < minY {
			minY = y
		}
		if x+nodeWidth > maxX {
			maxX = x + nodeWidth
		}
		if y+nodeHeight > maxY {
			maxY = y + nodeHeight
		}
	}
	if minX == 1e9 {
		minX, minY, maxX, maxY = 0, 0, 400, 200
	}
	width := int(maxX - minX + 40)
	height := int(maxY - minY + 40)
	if width < 400 {
		width = 400
	}
	if height < 200 {
		height = 200
	}

	posByID := make(map[string]*models.Position)
	for i := range g.Nodes {
		posByID[g.Nodes[i].ID] = g.Nodes[i].Position
	}

	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`, width, height, width, height))
	buf.WriteString(`<defs><style>.node { fill: #e2e8f0; stroke: #64748b; stroke-width: 1; } .edge { stroke: #94a3b8; stroke-width: 2; fill: none; } .label { font: 12px sans-serif; fill: #334155; }</style></defs>`)
	// Edges
	for _, e := range g.Edges {
		src, ok1 := posByID[e.Source]
		dst, ok2 := posByID[e.Target]
		if !ok1 || !ok2 || src == nil || dst == nil {
			continue
		}
		sx := src.X + nodeWidth/2
		sy := src.Y + nodeHeight
		dx := dst.X + nodeWidth/2
		dy := dst.Y
		buf.WriteString(fmt.Sprintf(`<path class="edge" d="M %f %f L %f %f"/>`, sx, sy, dx, dy))
	}
	// Nodes
	for _, n := range g.Nodes {
		if n.Position == nil {
			continue
		}
		x, y := n.Position.X, n.Position.Y
		label := n.Name
		if len(label) > 18 {
			label = label[:15] + "..."
		}
		label = escapeXML(label)
		kind := n.Kind
		if kind == "" {
			kind = "Resource"
		}
		buf.WriteString(fmt.Sprintf(`<rect class="node" x="%f" y="%f" width="%d" height="%d" rx="4"/>`, x, y, nodeWidth, nodeHeight))
		buf.WriteString(fmt.Sprintf(`<text class="label" x="%f" y="%f" text-anchor="middle">%s: %s</text>`, x+float64(nodeWidth)/2, y+nodeHeight/2+4, escapeXML(kind), label))
	}
	buf.WriteString("</svg>")
	return buf.Bytes(), nil
}

func escapeXML(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;").Replace(s)
}

