// Package safego provides a panic-recovering wrapper for launching
// goroutines.
//
// Every backend goroutine needs defer recover() (see the
// "goroutine-panic-recovery" convention in docs/ai/ARCHITECTURE.md) — an
// unrecovered panic inside any one of them crashes the entire backend
// process for every connected cluster/session, not just the one
// request/loop that panicked. Before this package existed, each goroutine
// had to hand-roll its own `defer func() { if r := recover(); ... }()`
// block, and a review pass found ~40 of them had none at all despite docs
// claiming otherwise.
//
// safego.Go centralizes that pattern into one call so it can't be
// forgotten or written slightly wrong, and so it's mechanically checkable
// going forward (e.g. a CI grep for bare `go func(` / `go \w+\.\w+\(`
// outside safego.go and _test.go files should find nothing).
//
// This is a crash-prevention backstop, not a "pretend nothing happened"
// mechanism: recovered panics are logged loudly at Error level with the
// goroutine's name, the recovered value, and a full stack trace, exactly
// like a panic would print if left unrecovered — just without taking the
// whole process down with them.
package safego

import (
	"context"
	"log/slog"
	"runtime/debug"
)

// Go launches fn in a new goroutine. If fn panics, the panic is recovered
// and logged at Error level (via the default slog logger) with name, the
// recovered value, and a stack trace — it is never swallowed silently.
//
// name should be a short, stable, descriptive identifier for the
// goroutine (e.g. "cluster-discovery-kubeconfig-watch") — it appears in
// crash logs, so make it identifiable.
func Go(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Default().Error("panic in goroutine",
					"goroutine", name,
					"panic", r,
					"stack", string(debug.Stack()),
				)
			}
		}()
		fn()
	}()
}

// GoContext launches fn in a new goroutine, passing it ctx. It otherwise
// behaves exactly like Go: panics inside fn are recovered and logged at
// Error level with name, the recovered value, and a stack trace.
//
// Use this variant when fn needs a context for cancellation/deadlines
// rather than closing over one from the caller's scope.
func GoContext(ctx context.Context, name string, fn func(context.Context)) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				slog.Default().Error("panic in goroutine",
					"goroutine", name,
					"panic", r,
					"stack", string(debug.Stack()),
				)
			}
		}()
		fn(ctx)
	}()
}
