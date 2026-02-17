package cli

import (
	"strings"
	"testing"
	"time"
)

func TestParseLogsOptions(t *testing.T) {
	opts, err := parseLogsOptions([]string{"app=api", "-f", "--timestamps", "--tail", "100", "--since=30m", "--grep", "error", "--grep-v", "debug", "--save=out.log", "--ai-summarize", "--ai-errors", "--ai-explain", "-n", "ops"}, "default")
	if err != nil {
		t.Fatalf("parseLogsOptions error: %v", err)
	}
	if opts.Target != "app=api" || !opts.Follow || !opts.Timestamps || opts.Tail != "100" || opts.Since != "30m" || opts.Grep != "error" || opts.GrepV != "debug" || opts.Save != "out.log" || opts.Namespace != "ops" || !opts.AISummarize || !opts.AIErrors || !opts.AIExplain {
		t.Fatalf("unexpected opts: %+v", opts)
	}
}

func TestIsMultiPodTarget(t *testing.T) {
	cases := map[string]bool{
		"":                 false,
		"mypod":            false,
		"app=api":          true,
		"app=api,tier=web": true,
		"deployment/api":   true,
		"deploy/api":       true,
	}
	for in, want := range cases {
		if got := isMultiPodTarget(in); got != want {
			t.Fatalf("isMultiPodTarget(%q)=%v want %v", in, got, want)
		}
	}
}

func TestCompileLogFilters(t *testing.T) {
	match, exclude, err := compileLogFilters(logsOptions{Grep: "error", GrepV: "debug"})
	if err != nil {
		t.Fatalf("compileLogFilters error: %v", err)
	}
	if !match.MatchString("error happened") {
		t.Fatal("expected match regex to match")
	}
	if !exclude.MatchString("debug line") {
		t.Fatal("expected exclude regex to match")
	}
	if _, _, err := compileLogFilters(logsOptions{Grep: "["}); err == nil {
		t.Fatal("expected invalid regex error")
	}
}

func TestExtractErrorLines(t *testing.T) {
	logs := "INFO startup ok\nERROR db connection failed\nwarning retrying\npanic: fatal crash\nERROR db connection failed\n"
	errs := extractErrorLines(logs)
	if len(errs) != 2 {
		t.Fatalf("expected 2 unique error lines, got %d: %+v", len(errs), errs)
	}
	if errs[0] != "ERROR db connection failed" {
		t.Fatalf("unexpected first error line: %q", errs[0])
	}
}

func TestExtractErrorLinesPerformance(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 1000; i++ {
		if i%10 == 0 {
			b.WriteString("ERROR request failed due to timeout\n")
		} else {
			b.WriteString("INFO request ok\n")
		}
	}
	start := time.Now()
	errs := extractErrorLines(b.String())
	elapsed := time.Since(start)
	if len(errs) == 0 {
		t.Fatal("expected extracted errors")
	}
	if elapsed > 200*time.Millisecond {
		t.Fatalf("extractErrorLines too slow for 1000 lines: %s", elapsed)
	}
}
