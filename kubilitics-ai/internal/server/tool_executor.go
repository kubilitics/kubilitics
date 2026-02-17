package server

// tool_executor.go — bridges types.ToolExecutor to the MCP server.
//
// mcpToolExecutor wraps an MCPServer so that the LLM agentic loop can
// execute tool calls without knowing about MCP internals.  Every call is
// marshalled to a JSON string so the LLM can include it in its context.

import (
	"context"
	"encoding/json"
	"fmt"

	mcpserver "github.com/kubilitics/kubilitics-ai/internal/mcp/server"
)

// mcpToolExecutor implements types.ToolExecutor by delegating to an MCPServer.
type mcpToolExecutor struct {
	mcp mcpserver.MCPServer
}

// newMCPToolExecutor creates a new executor backed by the given MCP server.
func newMCPToolExecutor(mcp mcpserver.MCPServer) *mcpToolExecutor {
	return &mcpToolExecutor{mcp: mcp}
}

// Execute runs the named tool with the provided arguments.
// The result is serialised to JSON so the LLM can read it as plain text.
func (e *mcpToolExecutor) Execute(ctx context.Context, toolName string, args map[string]interface{}) (string, error) {
	result, err := e.mcp.ExecuteTool(ctx, toolName, args)
	if err != nil {
		return "", fmt.Errorf("mcp execute %q: %w", toolName, err)
	}

	// Normalise result to a JSON string.
	switch v := result.(type) {
	case string:
		return v, nil
	case []byte:
		return string(v), nil
	default:
		b, jsonErr := json.Marshal(result)
		if jsonErr != nil {
			return fmt.Sprintf("%v", result), nil
		}
		return string(b), nil
	}
}
