package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// GenerateAPIKey generates a secure random API key (BE-AUTH-003).
// Returns the plaintext key (to be shown once) and its bcrypt hash.
func GenerateAPIKey() (plaintext string, hash string, err error) {
	// Generate 32 random bytes (256 bits)
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	// Encode as base64 URL-safe string (no padding)
	plaintext = base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(bytes)
	// Prefix with "kub_" for identification
	plaintext = "kub_" + plaintext
	
	// Hash using bcrypt (same as passwords)
	hash, err = HashPassword(plaintext)
	if err != nil {
		return "", "", fmt.Errorf("failed to hash API key: %w", err)
	}
	return plaintext, hash, nil
}

// CheckAPIKey verifies if a plaintext API key matches the hash.
func CheckAPIKey(hash, plaintext string) error {
	return CheckPassword(hash, plaintext)
}
