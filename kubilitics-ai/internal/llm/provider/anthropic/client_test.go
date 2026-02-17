package anthropic

import (
	"context"
	"testing"
)

func TestNewAnthropicClient(t *testing.T) {
	// Test with explicit API key and model
	client, err := NewAnthropicClient("test-key", "claude-3-5-sonnet-20241022")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	if client.apiKey != "test-key" {
		t.Errorf("Expected API key 'test-key', got '%s'", client.apiKey)
	}
	if client.model != "claude-3-5-sonnet-20241022" {
		t.Errorf("Expected model 'claude-3-5-sonnet-20241022', got '%s'", client.model)
	}
	if client.maxTokens != DefaultMaxTokens {
		t.Errorf("Expected default max tokens %d, got %d", DefaultMaxTokens, client.maxTokens)
	}
	if client.baseURL != DefaultBaseURL {
		t.Errorf("Expected default base URL %s, got %s", DefaultBaseURL, client.baseURL)
	}
}

func TestNewAnthropicClientDefaults(t *testing.T) {
	// Test with defaults (will use env vars or fallback)
	client, err := NewAnthropicClient("test-key", "")
	if err != nil {
		t.Fatalf("Failed to create client: %v", err)
	}

	if client.model != DefaultModel {
		t.Logf("Model set to: %s", client.model)
	}
}

func TestNewAnthropicClientValidation(t *testing.T) {
	// Empty API key should fail
	_, err := NewAnthropicClient("", "")
	if err == nil {
		t.Error("Expected error for empty API key")
	}
}

func TestConvertMessages(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	messages := []interface{}{
		map[string]interface{}{
			"role":    "user",
			"content": "Hello",
		},
		map[string]interface{}{
			"role":    "assistant",
			"content": "Hi there",
		},
		map[string]interface{}{
			"role":    "user",
			"content": "How are you?",
		},
	}

	anthMessages, err := client.convertMessages(messages)
	if err != nil {
		t.Fatalf("Failed to convert messages: %v", err)
	}

	if len(anthMessages) != 3 {
		t.Errorf("Expected 3 messages, got %d", len(anthMessages))
	}

	if anthMessages[0].Role != "user" {
		t.Errorf("Expected role 'user', got '%s'", anthMessages[0].Role)
	}
	if len(anthMessages[0].Content) != 1 {
		t.Errorf("Expected 1 content block, got %d", len(anthMessages[0].Content))
	}
	if anthMessages[0].Content[0].Type != "text" {
		t.Errorf("Expected type 'text', got '%s'", anthMessages[0].Content[0].Type)
	}
	if anthMessages[0].Content[0].Text != "Hello" {
		t.Errorf("Expected text 'Hello', got '%s'", anthMessages[0].Content[0].Text)
	}
}

func TestConvertSystemMessage(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	messages := []interface{}{
		map[string]interface{}{
			"role":    "system",
			"content": "You are a helpful assistant",
		},
	}

	anthMessages, err := client.convertMessages(messages)
	if err != nil {
		t.Fatalf("Failed to convert messages: %v", err)
	}

	// System messages are converted to user messages with [SYSTEM] prefix
	if anthMessages[0].Role != "user" {
		t.Errorf("Expected system message to be converted to user, got '%s'", anthMessages[0].Role)
	}
	if anthMessages[0].Content[0].Text != "[SYSTEM] You are a helpful assistant" {
		t.Errorf("Expected [SYSTEM] prefix, got '%s'", anthMessages[0].Content[0].Text)
	}
}

func TestConvertMessagesValidation(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	// Invalid message format
	invalidMessages := []interface{}{
		"not a map",
	}

	_, err := client.convertMessages(invalidMessages)
	if err == nil {
		t.Error("Expected error for invalid message format")
	}

	// Missing role
	missingRole := []interface{}{
		map[string]interface{}{
			"content": "Hello",
		},
	}

	_, err = client.convertMessages(missingRole)
	if err == nil {
		t.Error("Expected error for missing role")
	}

	// Missing content
	missingContent := []interface{}{
		map[string]interface{}{
			"role": "user",
		},
	}

	_, err = client.convertMessages(missingContent)
	if err == nil {
		t.Error("Expected error for missing content")
	}
}

func TestConvertTools(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	tools := []interface{}{
		map[string]interface{}{
			"name":        "get_weather",
			"description": "Get weather for a location",
			"input_schema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"location": map[string]interface{}{
						"type": "string",
					},
				},
			},
		},
	}

	anthTools, err := client.convertTools(tools)
	if err != nil {
		t.Fatalf("Failed to convert tools: %v", err)
	}

	if len(anthTools) != 1 {
		t.Errorf("Expected 1 tool, got %d", len(anthTools))
	}

	if anthTools[0].Name != "get_weather" {
		t.Errorf("Expected name 'get_weather', got '%s'", anthTools[0].Name)
	}
	if anthTools[0].Description != "Get weather for a location" {
		t.Errorf("Unexpected description: %s", anthTools[0].Description)
	}
}

func TestConvertToolsEmpty(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	anthTools, err := client.convertTools([]interface{}{})
	if err != nil {
		t.Fatalf("Failed to convert empty tools: %v", err)
	}

	if anthTools != nil {
		t.Errorf("Expected nil for empty tools, got %v", anthTools)
	}
}

func TestConvertToolsValidation(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	// Invalid tool format
	invalidTools := []interface{}{
		"not a map",
	}

	_, err := client.convertTools(invalidTools)
	if err == nil {
		t.Error("Expected error for invalid tool format")
	}

	// Missing name
	missingName := []interface{}{
		map[string]interface{}{
			"description": "A tool",
		},
	}

	_, err = client.convertTools(missingName)
	if err == nil {
		t.Error("Expected error for missing tool name")
	}
}

func TestCountTokens(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	messages := []interface{}{
		map[string]interface{}{
			"role":    "user",
			"content": "Hello, how are you?",
		},
	}

	tokens, err := client.CountTokens(context.Background(), messages, nil)
	if err != nil {
		t.Fatalf("Failed to count tokens: %v", err)
	}

	// Should be roughly 5-6 tokens (rough estimate: 4 chars/token)
	if tokens < 3 || tokens > 10 {
		t.Errorf("Expected ~5 tokens, got %d", tokens)
	}
}

func TestGetCapabilities(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", "claude-3-5-sonnet-20241022")

	caps, err := client.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("Failed to get capabilities: %v", err)
	}

	capsMap, ok := caps.(Capabilities)
	if !ok {
		t.Fatal("Expected Capabilities struct")
	}

	if !capsMap.Streaming {
		t.Error("Expected streaming to be supported")
	}
	if !capsMap.ToolUse {
		t.Error("Expected tool use to be supported")
	}
	if !capsMap.ExtendedThinking {
		t.Error("Expected extended thinking for Sonnet 3.5")
	}
	if capsMap.MaxTokens != 200000 {
		t.Errorf("Expected 200K max tokens, got %d", capsMap.MaxTokens)
	}
	if capsMap.InputCostPer1K != 0.003 {
		t.Errorf("Expected input cost 0.003, got %f", capsMap.InputCostPer1K)
	}
	if capsMap.OutputCostPer1K != 0.015 {
		t.Errorf("Expected output cost 0.015, got %f", capsMap.OutputCostPer1K)
	}
}

func TestGetCapabilitiesHaiku(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", "claude-3-haiku-20240307")

	caps, err := client.GetCapabilities(context.Background())
	if err != nil {
		t.Fatalf("Failed to get capabilities: %v", err)
	}

	capsMap := caps.(Capabilities)

	if capsMap.ExtendedThinking {
		t.Error("Expected Haiku not to support extended thinking")
	}
	if capsMap.InputCostPer1K != 0.00025 {
		t.Errorf("Expected Haiku input cost 0.00025, got %f", capsMap.InputCostPer1K)
	}
	if capsMap.OutputCostPer1K != 0.00125 {
		t.Errorf("Expected Haiku output cost 0.00125, got %f", capsMap.OutputCostPer1K)
	}
}

func TestValidateToolCall(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	err := client.ValidateToolCall(context.Background(), "get_weather", map[string]interface{}{
		"location": "San Francisco",
	})
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}

	// Empty tool name should fail
	err = client.ValidateToolCall(context.Background(), "", map[string]interface{}{})
	if err == nil {
		t.Error("Expected error for empty tool name")
	}
}

func TestNormalizeToolCall(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	// Anthropic format
	toolCall := map[string]interface{}{
		"id":   "call_123",
		"name": "get_weather",
		"input": map[string]interface{}{
			"location": "San Francisco",
		},
	}

	normalized, err := client.NormalizeToolCall(context.Background(), toolCall)
	if err != nil {
		t.Fatalf("Failed to normalize tool call: %v", err)
	}

	if normalized["tool_name"] != "get_weather" {
		t.Errorf("Expected tool_name 'get_weather', got '%v'", normalized["tool_name"])
	}

	args, ok := normalized["args"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected args to be a map")
	}

	if args["location"] != "San Francisco" {
		t.Errorf("Expected location 'San Francisco', got '%v'", args["location"])
	}
}

func TestNormalizeToolCallValidation(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	// Invalid format
	_, err := client.NormalizeToolCall(context.Background(), "not a map")
	if err == nil {
		t.Error("Expected error for invalid tool call format")
	}
}

func TestCompleteStream(t *testing.T) {
	client, _ := NewAnthropicClient("test-key", DefaultModel)

	messages := []interface{}{
		map[string]interface{}{
			"role":    "user",
			"content": "Hello",
		},
	}

	textChan, toolChan, err := client.CompleteStream(context.Background(), messages, nil)
	if err != nil {
		t.Fatalf("Failed to start stream: %v", err)
	}

	// Consume channels
	for text := range textChan {
		t.Logf("Received text: %s", text)
	}

	for tool := range toolChan {
		t.Logf("Received tool: %v", tool)
	}
}

func TestModelCosts(t *testing.T) {
	models := []string{
		"claude-3-5-sonnet-20241022",
		"claude-3-opus-20240229",
		"claude-3-sonnet-20240229",
		"claude-3-haiku-20240307",
	}

	for _, model := range models {
		costs, ok := modelCosts[model]
		if !ok {
			t.Errorf("Model %s not found in cost table", model)
			continue
		}

		if costs.InputCost <= 0 {
			t.Errorf("Model %s has invalid input cost: %f", model, costs.InputCost)
		}
		if costs.OutputCost <= 0 {
			t.Errorf("Model %s has invalid output cost: %f", model, costs.OutputCost)
		}

		t.Logf("Model %s: Input=$%.5f/1K, Output=$%.5f/1K", model, costs.InputCost, costs.OutputCost)
	}
}
