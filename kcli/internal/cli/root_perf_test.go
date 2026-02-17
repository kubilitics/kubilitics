package cli

import (
	"testing"
	"time"
)

func TestAIClientIsMemoized(t *testing.T) {
	a := &app{aiTimeout: 3 * time.Second}
	c1 := a.aiClient()
	c2 := a.aiClient()
	if c1 != c2 {
		t.Fatal("expected aiClient() to return memoized instance")
	}
}
