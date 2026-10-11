package safego

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestGo_PanicIsRecovered proves a panicking fn does not crash the test
// process or propagate out of Go — this is the entire reason the package
// exists.
func TestGo_PanicIsRecovered(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)

	done := make(chan struct{})
	go func() {
		// This goroutine exists only to detect whether the test process
		// is still alive after the panic. If safego.Go failed to recover,
		// the panic would have already crashed the whole process by now
		// and this would never run.
		wg.Wait()
		close(done)
	}()

	Go("test-panicking-goroutine", func() {
		defer wg.Done()
		panic("boom: intentional test panic")
	})

	select {
	case <-done:
		// fn ran, panicked, was recovered, and wg.Done() still fired —
		// process is alive and the wrapper did not propagate the panic.
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for panicking goroutine to complete via recovery")
	}
}

// TestGo_NormalExecution proves a non-panicking fn's side effects run
// normally through the wrapper.
func TestGo_NormalExecution(t *testing.T) {
	var ran atomic.Bool
	done := make(chan struct{})

	Go("test-normal-goroutine", func() {
		ran.Store(true)
		close(done)
	})

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for goroutine to run")
	}

	if !ran.Load() {
		t.Fatal("expected fn side effect to have run")
	}
}

// TestGoContext_PanicIsRecovered proves the context-aware variant also
// recovers panics without propagating them.
func TestGoContext_PanicIsRecovered(t *testing.T) {
	var wg sync.WaitGroup
	wg.Add(1)
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	ctx := context.Background()
	GoContext(ctx, "test-panicking-context-goroutine", func(_ context.Context) {
		defer wg.Done()
		panic("boom: intentional context test panic")
	})

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for panicking context goroutine to complete via recovery")
	}
}

// TestGoContext_NormalExecution proves the context-aware variant passes
// ctx through and runs fn's side effects normally.
func TestGoContext_NormalExecution(t *testing.T) {
	type ctxKey string
	key := ctxKey("k")
	ctx := context.WithValue(context.Background(), key, "v")

	var gotValue atomic.Value
	done := make(chan struct{})

	GoContext(ctx, "test-normal-context-goroutine", func(c context.Context) {
		if v, ok := c.Value(key).(string); ok {
			gotValue.Store(v)
		}
		close(done)
	})

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for context goroutine to run")
	}

	if v, _ := gotValue.Load().(string); v != "v" {
		t.Fatalf("expected context value 'v' to propagate, got %q", v)
	}
}
