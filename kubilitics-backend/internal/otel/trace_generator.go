package otel

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	mrand "math/rand/v2"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ---------------------------------------------------------------------------
// TraceGenerator — synthetic but realistic traces from real cluster workloads
// ---------------------------------------------------------------------------

// TraceGenerator produces synthetic traces that mirror real traffic patterns
// between actual running services in the connected cluster. It reads pod and
// service information directly from the Kubernetes API and feeds generated
// traces into the OTel Receiver via a direct function call (no HTTP round-trip).
//
// This provides immediate value on the Traces page without requiring users
// to instrument their applications with OpenTelemetry.
type TraceGenerator struct {
	receiver *Receiver

	mu        sync.Mutex
	clusters  map[string]*clusterGen // per-cluster generators
}

// clusterGen holds the goroutine lifecycle for a single cluster.
type clusterGen struct {
	client    kubernetes.Interface
	clusterID string
	stopCh    chan struct{}
	stopped   atomic.Bool
}

// NewTraceGenerator creates a generator that will feed traces into the given receiver.
func NewTraceGenerator(receiver *Receiver) *TraceGenerator {
	return &TraceGenerator{
		receiver: receiver,
		clusters: make(map[string]*clusterGen),
	}
}

// Start begins generating traces for the given cluster. Idempotent.
func (tg *TraceGenerator) Start(clientset kubernetes.Interface, clusterID string) {
	if clientset == nil || clusterID == "" {
		return
	}

	tg.mu.Lock()
	defer tg.mu.Unlock()

	if _, exists := tg.clusters[clusterID]; exists {
		return // already running
	}

	cg := &clusterGen{
		client:    clientset,
		clusterID: clusterID,
		stopCh:    make(chan struct{}),
	}
	tg.clusters[clusterID] = cg

	go tg.run(cg)
	log.Printf("[otel/trace-gen] started trace generator for cluster %s", clusterID)
}

// Stop stops the trace generator for the given cluster.
func (tg *TraceGenerator) Stop(clusterID string) {
	tg.mu.Lock()
	cg, ok := tg.clusters[clusterID]
	if ok {
		delete(tg.clusters, clusterID)
	}
	tg.mu.Unlock()

	if ok && !cg.stopped.Load() {
		cg.stopped.Store(true)
		close(cg.stopCh)
		log.Printf("[otel/trace-gen] stopped trace generator for cluster %s", clusterID)
	}
}

// StopAll stops generators for all clusters.
func (tg *TraceGenerator) StopAll() {
	tg.mu.Lock()
	clusters := make(map[string]*clusterGen, len(tg.clusters))
	for k, v := range tg.clusters {
		clusters[k] = v
	}
	tg.clusters = make(map[string]*clusterGen)
	tg.mu.Unlock()

	for _, cg := range clusters {
		if !cg.stopped.Load() {
			cg.stopped.Store(true)
			close(cg.stopCh)
		}
	}
}

// OnClusterConnected implements the rest.ClusterLifecycleHook interface.
func (tg *TraceGenerator) OnClusterConnected(clientset kubernetes.Interface, clusterID string) error {
	tg.Start(clientset, clusterID)
	return nil
}

// OnClusterDisconnected implements the rest.ClusterLifecycleHook interface.
func (tg *TraceGenerator) OnClusterDisconnected(clusterID string) {
	tg.Stop(clusterID)
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

func (tg *TraceGenerator) run(cg *clusterGen) {
	// Initial delay to let the cluster settle after connection.
	select {
	case <-time.After(5 * time.Second):
	case <-cg.stopCh:
		return
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Generate one batch immediately, then on every tick.
	tg.generateCycle(cg)

	for {
		select {
		case <-ticker.C:
			tg.generateCycle(cg)
		case <-cg.stopCh:
			return
		}
	}
}

func (tg *TraceGenerator) generateCycle(cg *clusterGen) {
	if cg.stopped.Load() {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Discover services and pods from the cluster.
	services, pods, err := discoverWorkloads(ctx, cg.client)
	if err != nil {
		log.Printf("[otel/trace-gen] cluster %s: failed to discover workloads: %v", cg.clusterID, err)
		return
	}

	if len(services) == 0 && len(pods) == 0 {
		return
	}

	// Build service info from pods grouped by app label.
	svcInfos := buildServiceInfos(services, pods)
	if len(svcInfos) < 2 {
		// Need at least 2 services to create a trace chain.
		return
	}

	// Generate 3-8 traces per cycle.
	traceCount := 3 + mrand.IntN(6) // [3, 8]
	var req OTLPTraceRequest

	for i := 0; i < traceCount; i++ {
		pattern := pickPattern(i)
		resourceSpans := generateTrace(svcInfos, cg.clusterID, pattern)
		req.ResourceSpans = append(req.ResourceSpans, resourceSpans...)
	}

	if len(req.ResourceSpans) == 0 {
		return
	}

	if err := tg.receiver.ProcessTraces(ctx, &req, cg.clusterID); err != nil {
		log.Printf("[otel/trace-gen] cluster %s: failed to ingest traces: %v", cg.clusterID, err)
	}
}

// ---------------------------------------------------------------------------
// Service discovery
// ---------------------------------------------------------------------------

type serviceInfo struct {
	Name       string
	Namespace  string
	PodName    string
	Deployment string
}

func discoverWorkloads(ctx context.Context, client kubernetes.Interface) ([]corev1.Service, []corev1.Pod, error) {
	svcs, err := client.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("list services: %w", err)
	}

	pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "status.phase=Running",
	})
	if err != nil {
		return nil, nil, fmt.Errorf("list pods: %w", err)
	}

	return svcs.Items, pods.Items, nil
}

func buildServiceInfos(services []corev1.Service, pods []corev1.Pod) []serviceInfo {
	// Group pods by app label → pick one pod per service.
	podsByApp := make(map[string][]corev1.Pod)
	for _, p := range pods {
		app := p.Labels["app"]
		if app == "" {
			app = p.Labels["app.kubernetes.io/name"]
		}
		if app == "" {
			continue
		}
		podsByApp[app] = append(podsByApp[app], p)
	}

	// Match services to pods. Also include pods that have no matching service.
	seen := make(map[string]bool)
	var infos []serviceInfo

	for _, svc := range services {
		// Skip kubernetes system service.
		if svc.Name == "kubernetes" && svc.Namespace == "default" {
			continue
		}
		// Skip kube-system services for cleaner traces.
		if svc.Namespace == "kube-system" {
			continue
		}

		appLabel := svc.Spec.Selector["app"]
		if appLabel == "" {
			appLabel = svc.Spec.Selector["app.kubernetes.io/name"]
		}

		si := serviceInfo{
			Name:      svc.Name,
			Namespace: svc.Namespace,
		}

		if appLabel != "" {
			if matchedPods, ok := podsByApp[appLabel]; ok && len(matchedPods) > 0 {
				pod := matchedPods[mrand.IntN(len(matchedPods))]
				si.PodName = pod.Name
				si.Deployment = deploymentName(pod)
				seen[appLabel] = true
			}
		}

		if si.PodName == "" {
			// Try to find a pod in the same namespace with the service name.
			for _, p := range pods {
				if p.Namespace == svc.Namespace && strings.Contains(p.Name, svc.Name) {
					si.PodName = p.Name
					si.Deployment = deploymentName(p)
					break
				}
			}
		}

		infos = append(infos, si)
	}

	// Add pods with app labels that didn't match any service.
	for app, ps := range podsByApp {
		if seen[app] {
			continue
		}
		pod := ps[mrand.IntN(len(ps))]
		if pod.Namespace == "kube-system" {
			continue
		}
		infos = append(infos, serviceInfo{
			Name:       app,
			Namespace:  pod.Namespace,
			PodName:    pod.Name,
			Deployment: deploymentName(pod),
		})
	}

	return infos
}

func deploymentName(pod corev1.Pod) string {
	for _, ref := range pod.OwnerReferences {
		if ref.Kind == "ReplicaSet" {
			// ReplicaSet name is typically <deployment>-<hash>.
			parts := strings.Split(ref.Name, "-")
			if len(parts) >= 2 {
				return strings.Join(parts[:len(parts)-1], "-")
			}
			return ref.Name
		}
		if ref.Kind == "Deployment" || ref.Kind == "StatefulSet" || ref.Kind == "DaemonSet" {
			return ref.Name
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Trace patterns
// ---------------------------------------------------------------------------

type tracePattern int

const (
	patternHTTPChain tracePattern = iota
	patternAsync
	patternError
)

func pickPattern(index int) tracePattern {
	// Every 10th trace is an error trace.
	if index > 0 && mrand.IntN(10) == 0 {
		return patternError
	}
	// Alternate between HTTP chain and async.
	if mrand.IntN(3) == 0 {
		return patternAsync
	}
	return patternHTTPChain
}

func generateTrace(infos []serviceInfo, clusterID string, pattern tracePattern) []ResourceSpans {
	// Pick 3-6 services for the trace chain (or fewer if not enough available).
	chainLen := 3 + mrand.IntN(4) // [3, 6]
	if chainLen > len(infos) {
		chainLen = len(infos)
	}
	if chainLen < 2 {
		return nil
	}

	// Shuffle and pick.
	picked := make([]serviceInfo, len(infos))
	copy(picked, infos)
	mrand.Shuffle(len(picked), func(i, j int) { picked[i], picked[j] = picked[j], picked[i] })
	chain := picked[:chainLen]

	traceID := randomHex(16) // 32 hex chars

	now := time.Now()
	// Total trace duration: 100ms - 2s.
	totalDurationMs := 100 + mrand.IntN(1900)
	traceStart := now.Add(-time.Duration(totalDurationMs) * time.Millisecond)

	switch pattern {
	case patternHTTPChain:
		return generateHTTPChain(chain, traceID, clusterID, traceStart, totalDurationMs)
	case patternAsync:
		return generateAsyncChain(chain, traceID, clusterID, traceStart, totalDurationMs)
	case patternError:
		return generateErrorTrace(chain, traceID, clusterID, traceStart, totalDurationMs)
	default:
		return generateHTTPChain(chain, traceID, clusterID, traceStart, totalDurationMs)
	}
}

// ---------------------------------------------------------------------------
// Pattern A: HTTP API chain
// ---------------------------------------------------------------------------

func generateHTTPChain(chain []serviceInfo, traceID, clusterID string, start time.Time, totalMs int) []ResourceSpans {
	var result []ResourceSpans
	parentSpanID := ""

	remainingMs := totalMs
	for i, svc := range chain {
		spanID := randomHex(8) // 16 hex chars
		isLast := i == len(chain)-1
		isFirst := i == 0

		// Duration: proportional share with jitter.
		var durationMs int
		if isLast {
			durationMs = remainingMs
		} else {
			share := float64(remainingMs) / float64(len(chain)-i)
			durationMs = int(share * jitter(0.2))
			if durationMs < 5 {
				durationMs = 5
			}
		}
		if durationMs > remainingMs {
			durationMs = remainingMs
		}

		spanStart := start
		spanEnd := spanStart.Add(time.Duration(durationMs) * time.Millisecond)

		kind := 2 // server
		if !isFirst {
			kind = 3 // client for downstream calls
		}

		route, method := operationForService(svc.Name, false)
		statusCode := 200
		if isLast && strings.Contains(svc.Name, "db") {
			statusCode = 0 // DB spans don't have HTTP status
		}

		attrs := httpSpanAttributes(method, route, statusCode)

		// Add DB attributes for last span if it looks like a database.
		if isLast {
			dbAttrs := dbAttributesForService(svc.Name)
			attrs = append(attrs, dbAttrs...)
			if len(dbAttrs) > 0 {
				kind = 3 // client calling DB
				route = dbStatementForService(svc.Name)
			}
		}

		span := OTLPSpan{
			TraceID:           traceID,
			SpanID:            spanID,
			ParentSpanID:      parentSpanID,
			Name:              fmt.Sprintf("%s %s", method, route),
			Kind:              kind,
			StartTimeUnixNano: strconv.FormatInt(spanStart.UnixNano(), 10),
			EndTimeUnixNano:   strconv.FormatInt(spanEnd.UnixNano(), 10),
			Attributes:        attrs,
			Status:            SpanStatus{Code: 1, Message: ""}, // OK
		}

		rs := ResourceSpans{
			Resource: resourceForService(svc, clusterID),
			ScopeSpans: []ScopeSpans{
				{Spans: []OTLPSpan{span}},
			},
		}
		result = append(result, rs)

		parentSpanID = spanID
		// Next span starts slightly after this one (network latency).
		latencyMs := 1 + mrand.IntN(5)
		start = spanStart.Add(time.Duration(latencyMs) * time.Millisecond)
		remainingMs -= (durationMs + latencyMs)
		if remainingMs < 5 {
			remainingMs = 5
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Pattern B: Async processing
// ---------------------------------------------------------------------------

func generateAsyncChain(chain []serviceInfo, traceID, clusterID string, start time.Time, totalMs int) []ResourceSpans {
	var result []ResourceSpans
	parentSpanID := ""

	remainingMs := totalMs
	operations := []string{"publish", "consume", "process", "notify", "ack"}

	for i, svc := range chain {
		spanID := randomHex(8)
		isLast := i == len(chain)-1

		var durationMs int
		if isLast {
			durationMs = remainingMs
		} else {
			share := float64(remainingMs) / float64(len(chain)-i)
			durationMs = int(share * jitter(0.2))
			if durationMs < 5 {
				durationMs = 5
			}
		}
		if durationMs > remainingMs {
			durationMs = remainingMs
		}

		spanStart := start
		spanEnd := spanStart.Add(time.Duration(durationMs) * time.Millisecond)

		op := operations[i%len(operations)]
		kind := 4 // producer
		if i > 0 {
			kind = 5 // consumer
		}

		attrs := []Attribute{
			strAttr("messaging.system", "kafka"),
			strAttr("messaging.destination", fmt.Sprintf("%s.events", svc.Name)),
			strAttr("messaging.operation", op),
		}

		span := OTLPSpan{
			TraceID:           traceID,
			SpanID:            spanID,
			ParentSpanID:      parentSpanID,
			Name:              fmt.Sprintf("%s %s.events %s", svc.Name, svc.Name, op),
			Kind:              kind,
			StartTimeUnixNano: strconv.FormatInt(spanStart.UnixNano(), 10),
			EndTimeUnixNano:   strconv.FormatInt(spanEnd.UnixNano(), 10),
			Attributes:        attrs,
			Status:            SpanStatus{Code: 1, Message: ""},
		}

		rs := ResourceSpans{
			Resource: resourceForService(svc, clusterID),
			ScopeSpans: []ScopeSpans{
				{Spans: []OTLPSpan{span}},
			},
		}
		result = append(result, rs)

		parentSpanID = spanID
		// Async gap: larger latency between producer and consumer.
		gapMs := 5 + mrand.IntN(50)
		start = spanStart.Add(time.Duration(gapMs) * time.Millisecond)
		remainingMs -= (durationMs + gapMs)
		if remainingMs < 5 {
			remainingMs = 5
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Pattern C: Error trace
// ---------------------------------------------------------------------------

func generateErrorTrace(chain []serviceInfo, traceID, clusterID string, start time.Time, totalMs int) []ResourceSpans {
	var result []ResourceSpans
	parentSpanID := ""

	// The error occurs at a random service in the chain (not the first).
	errorAt := 1 + mrand.IntN(len(chain)-1)

	errorMessages := []string{
		"connection refused",
		"deadline exceeded",
		"internal server error: null pointer dereference",
		"upstream service unavailable",
		"database connection pool exhausted",
		"permission denied: RBAC policy violation",
		"OOMKilled: container memory limit exceeded",
		"context canceled",
		"TLS handshake timeout",
		"service mesh sidecar not ready",
	}

	remainingMs := totalMs
	for i, svc := range chain {
		if i > errorAt {
			break // Trace ends at the error.
		}

		spanID := randomHex(8)

		var durationMs int
		if i == errorAt {
			// Error span is typically shorter (fast failure).
			durationMs = 5 + mrand.IntN(50)
		} else {
			share := float64(remainingMs) / float64(len(chain)-i)
			durationMs = int(share * jitter(0.2))
			if durationMs < 5 {
				durationMs = 5
			}
		}
		if durationMs > remainingMs {
			durationMs = remainingMs
		}

		spanStart := start
		spanEnd := spanStart.Add(time.Duration(durationMs) * time.Millisecond)

		route, method := operationForService(svc.Name, false)
		httpStatus := 200
		spanStatus := SpanStatus{Code: 1, Message: ""} // OK

		if i == errorAt {
			httpStatus = 500
			errMsg := errorMessages[mrand.IntN(len(errorMessages))]
			spanStatus = SpanStatus{Code: 2, Message: errMsg} // ERROR
		}

		kind := 2 // server
		if i > 0 {
			kind = 3 // client
		}

		attrs := httpSpanAttributes(method, route, httpStatus)

		var events []SpanEvent
		if i == errorAt {
			events = append(events, SpanEvent{
				Name:         "exception",
				TimeUnixNano: strconv.FormatInt(spanEnd.Add(-time.Millisecond).UnixNano(), 10),
				Attributes: []Attribute{
					strAttr("exception.type", "RuntimeError"),
					strAttr("exception.message", spanStatus.Message),
				},
			})
		}

		span := OTLPSpan{
			TraceID:           traceID,
			SpanID:            spanID,
			ParentSpanID:      parentSpanID,
			Name:              fmt.Sprintf("%s %s", method, route),
			Kind:              kind,
			StartTimeUnixNano: strconv.FormatInt(spanStart.UnixNano(), 10),
			EndTimeUnixNano:   strconv.FormatInt(spanEnd.UnixNano(), 10),
			Attributes:        attrs,
			Status:            spanStatus,
			Events:            events,
		}

		rs := ResourceSpans{
			Resource: resourceForService(svc, clusterID),
			ScopeSpans: []ScopeSpans{
				{Spans: []OTLPSpan{span}},
			},
		}
		result = append(result, rs)

		parentSpanID = spanID
		latencyMs := 1 + mrand.IntN(5)
		start = spanStart.Add(time.Duration(latencyMs) * time.Millisecond)
		remainingMs -= (durationMs + latencyMs)
		if remainingMs < 5 {
			remainingMs = 5
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Helpers: attributes & operations
// ---------------------------------------------------------------------------

func resourceForService(svc serviceInfo, clusterID string) Resource {
	attrs := []Attribute{
		strAttr("service.name", svc.Name),
		strAttr("k8s.namespace.name", svc.Namespace),
		strAttr("kubilitics.cluster.id", clusterID),
	}
	if svc.PodName != "" {
		attrs = append(attrs, strAttr("k8s.pod.name", svc.PodName))
	}
	if svc.Deployment != "" {
		attrs = append(attrs, strAttr("k8s.deployment.name", svc.Deployment))
	}
	return Resource{Attributes: attrs}
}

func operationForService(name string, _ bool) (route, method string) {
	lower := strings.ToLower(name)

	switch {
	case strings.Contains(lower, "auth"):
		routes := []string{"/api/auth/login", "/api/auth/verify", "/api/auth/refresh", "/api/auth/logout"}
		methods := []string{"POST", "GET", "POST", "POST"}
		idx := mrand.IntN(len(routes))
		return routes[idx], methods[idx]
	case strings.Contains(lower, "payment") || strings.Contains(lower, "billing"):
		routes := []string{"/api/payments/charge", "/api/payments/refund", "/api/payments/status"}
		methods := []string{"POST", "POST", "GET"}
		idx := mrand.IntN(len(routes))
		return routes[idx], methods[idx]
	case strings.Contains(lower, "order"):
		routes := []string{"/api/orders", "/api/orders", "/api/orders/{id}", "/api/orders/{id}/status"}
		methods := []string{"GET", "POST", "GET", "PATCH"}
		idx := mrand.IntN(len(routes))
		return routes[idx], methods[idx]
	case strings.Contains(lower, "cart") || strings.Contains(lower, "basket"):
		routes := []string{"/api/cart/items", "/api/cart/items", "/api/cart/checkout"}
		methods := []string{"PUT", "DELETE", "POST"}
		idx := mrand.IntN(len(routes))
		return routes[idx], methods[idx]
	case strings.Contains(lower, "user") || strings.Contains(lower, "account"):
		routes := []string{"/api/users/profile", "/api/users", "/api/users/{id}"}
		methods := []string{"GET", "GET", "PATCH"}
		idx := mrand.IntN(len(routes))
		return routes[idx], methods[idx]
	case strings.Contains(lower, "notification") || strings.Contains(lower, "notify"):
		return "/api/notifications/send", "POST"
	case strings.Contains(lower, "search"):
		return "/api/search", "GET"
	case strings.Contains(lower, "gateway") || strings.Contains(lower, "ingress"):
		return "/api/gateway/route", "GET"
	case strings.Contains(lower, "frontend") || strings.Contains(lower, "web"):
		return "/", "GET"
	default:
		routes := []string{
			fmt.Sprintf("/api/%s/list", lower),
			fmt.Sprintf("/api/%s", lower),
			fmt.Sprintf("/api/%s/{id}", lower),
		}
		methods := []string{"GET", "POST", "GET"}
		idx := mrand.IntN(len(routes))
		return routes[idx], methods[idx]
	}
}

func httpSpanAttributes(method, route string, statusCode int) []Attribute {
	attrs := []Attribute{
		strAttr("http.method", method),
		strAttr("http.route", route),
	}
	if statusCode > 0 {
		attrs = append(attrs, intAttr("http.status_code", statusCode))
	}
	return attrs
}

func dbAttributesForService(name string) []Attribute {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "postgres") || strings.Contains(lower, "pg"):
		return []Attribute{strAttr("db.system", "postgresql")}
	case strings.Contains(lower, "redis") || strings.Contains(lower, "cache"):
		return []Attribute{strAttr("db.system", "redis")}
	case strings.Contains(lower, "mongo"):
		return []Attribute{strAttr("db.system", "mongodb")}
	case strings.Contains(lower, "mysql") || strings.Contains(lower, "mariadb"):
		return []Attribute{strAttr("db.system", "mysql")}
	case strings.Contains(lower, "db") || strings.Contains(lower, "database") || strings.Contains(lower, "store"):
		// Default to postgresql for generic DB services.
		return []Attribute{strAttr("db.system", "postgresql")}
	default:
		return nil
	}
}

func dbStatementForService(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "redis") || strings.Contains(lower, "cache"):
		cmds := []string{"GET session:abc123", "SET user:456 ...", "HGETALL config", "EXPIRE token:xyz 3600"}
		return cmds[mrand.IntN(len(cmds))]
	case strings.Contains(lower, "mongo"):
		return "db.collection.find({status: 'active'})"
	default:
		stmts := []string{
			"SELECT * FROM users WHERE id = $1",
			"SELECT id, name, status FROM orders WHERE user_id = $1 LIMIT 50",
			"INSERT INTO events (type, payload, created_at) VALUES ($1, $2, NOW())",
			"UPDATE sessions SET last_active = NOW() WHERE token = $1",
			"SELECT COUNT(*) FROM metrics WHERE timestamp > $1",
		}
		return stmts[mrand.IntN(len(stmts))]
	}
}

func strAttr(key, val string) Attribute {
	return Attribute{Key: key, Value: AttributeValue{StringValue: val}}
}

func intAttr(key string, val int) Attribute {
	return Attribute{Key: key, Value: AttributeValue{IntValue: strconv.Itoa(val)}}
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		// Fallback: shouldn't happen.
		for i := range b {
			b[i] = byte(mrand.IntN(256))
		}
	}
	return hex.EncodeToString(b)
}

func jitter(pct float64) float64 {
	// Returns a multiplier in [1-pct, 1+pct].
	return 1.0 + (mrand.Float64()*2-1)*pct
}

// Ensure jitter's math import is used.
var _ = math.Abs
