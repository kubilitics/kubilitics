package auth

import (
	"strings"
	"testing"
)

func TestGenerateAPIKey(t *testing.T) {
	plaintext, hash, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}
	if plaintext == "" {
		t.Error("API key should not be empty")
	}
	if hash == "" {
		t.Error("Hash should not be empty")
	}
	if !strings.HasPrefix(plaintext, "kub_") {
		t.Error("API key should start with 'kub_' prefix")
	}
	if len(plaintext) < 20 {
		t.Error("API key should be reasonably long")
	}
}

func TestGenerateAPIKey_Unique(t *testing.T) {
	plaintext1, _, err1 := GenerateAPIKey()
	if err1 != nil {
		t.Fatalf("Failed to generate API key: %v", err1)
	}

	plaintext2, _, err2 := GenerateAPIKey()
	if err2 != nil {
		t.Fatalf("Failed to generate API key: %v", err2)
	}

	if plaintext1 == plaintext2 {
		t.Error("Generated API keys should be unique")
	}
}

func TestCheckAPIKey(t *testing.T) {
	plaintextKey, hashedKey, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("Failed to generate API key: %v", err)
	}

	// Check the key
	if err := CheckAPIKey(hashedKey, plaintextKey); err != nil {
		t.Error("CheckAPIKey should return nil for correct key")
	}

	// Wrong key
	if err := CheckAPIKey(hashedKey, "wrong-key"); err == nil {
		t.Error("CheckAPIKey should return error for wrong key")
	}
}

func TestCheckAPIKey_InvalidHash(t *testing.T) {
	invalidHash := "invalid-hash"
	key := "test-key"

	if err := CheckAPIKey(invalidHash, key); err == nil {
		t.Error("CheckAPIKey should return error for invalid hash")
	}
}
