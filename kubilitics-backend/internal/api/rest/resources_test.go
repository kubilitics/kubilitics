package rest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	ktesting "k8s.io/client-go/testing"
)

// docs/ai/STABILIZATION-PLAN.md Phase 2 item 1: resources_mutation_test.go
// already covers the core PatchResource/DeleteResource/ApplyManifest happy
// paths for one resource kind each (Deployment/Pod/ConfigMap) plus the
// not-found/invalid-body error paths. This file adds the remaining gaps
// called out in the plan: success across multiple distinct resource kinds,
// an RBAC/permission-denied path, and a GVK/kind-resolution edge case
// (a kind the GVR map and fake discovery client both fail to resolve) — so
// a regression that silently breaks delete for one kind, or that stops
// surfacing Forbidden/unknown-kind errors correctly, has a test that fails.

func toUnstructuredStatefulSet(s *appsv1.StatefulSet) *unstructured.Unstructured {
	s.TypeMeta = metav1.TypeMeta{APIVersion: "apps/v1", Kind: "StatefulSet"}
	obj, err := runtime.DefaultUnstructuredConverter.ToUnstructured(s)
	if err != nil {
		panic(err)
	}
	return &unstructured.Unstructured{Object: obj}
}

// TestDeleteResource_MultipleKinds exercises DeleteResource's GVK resolution
// for several distinct kinds (not just Pod, which resources_mutation_test.go
// already covers), since the GVR mapping is the part of DeleteResource most
// likely to silently regress for a single kind while every other kind
// keeps working.
func TestDeleteResource_MultipleKinds(t *testing.T) {
	cases := []struct {
		name      string
		kind      string // path segment used by the handler's {kind} route var
		namespace string
		object    *unstructured.Unstructured
	}{
		{
			name:      "deployment",
			kind:      "deployments",
			namespace: "default",
			object: toUnstructuredDeployment(&appsv1.Deployment{
				ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
			}),
		},
		{
			name:      "statefulset",
			kind:      "statefulsets",
			namespace: "default",
			object: toUnstructuredStatefulSet(&appsv1.StatefulSet{
				ObjectMeta: metav1.ObjectMeta{Name: "db", Namespace: "default"},
			}),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clusterID := "test-cluster"
			client := newMutableTestClient(t, tc.object)
			_, router := newMutationTestHandler(t, client, clusterID)

			name := tc.object.GetName()
			req := httptest.NewRequest(http.MethodDelete,
				"/api/v1/clusters/"+clusterID+"/resources/"+tc.kind+"/"+tc.namespace+"/"+name, nil)
			req.Header.Set(DestructiveConfirmHeader, "true")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200 deleting %s, got %d: %s", tc.kind, rec.Code, rec.Body.String())
			}

			if _, err := client.GetResource(req.Context(), tc.kind, tc.namespace, name); err == nil {
				t.Errorf("expected %s %q to be deleted, but GetResource still found it", tc.kind, name)
			}
		})
	}
}

// TestDeleteResource_UnknownKind is the GVK/kind-resolution edge case: a
// syntactically valid kind (passes validate.Kind) that neither the
// hardcoded GVR map nor live discovery can resolve. DeleteResource must
// surface this as a clean error, not panic or silently no-op.
func TestDeleteResource_UnknownKind(t *testing.T) {
	clusterID := "test-cluster"
	client := newMutableTestClient(t)
	_, router := newMutationTestHandler(t, client, clusterID)

	req := httptest.NewRequest(http.MethodDelete,
		"/api/v1/clusters/"+clusterID+"/resources/totallyunknownkind/default/thing", nil)
	req.Header.Set(DestructiveConfirmHeader, "true")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("expected a non-200 response for an unresolvable kind, got 200: %s", rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "unknown resource type") {
		t.Errorf("expected error body to mention the unresolvable kind, got: %s", rec.Body.String())
	}
}

// TestDeleteResource_Forbidden covers the RBAC/permission-denied path: the
// (fake) dynamic client rejects the delete with a Forbidden error, and the
// handler must translate that into HTTP 403, not a generic 500.
func TestDeleteResource_Forbidden(t *testing.T) {
	clusterID := "test-cluster"
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "locked", Namespace: "default"}}
	client := newMutableTestClient(t, toUnstructuredPod(pod))

	dyn, ok := client.Dynamic.(*dynamicfake.FakeDynamicClient)
	if !ok {
		t.Fatalf("expected client.Dynamic to be a *dynamicfake.FakeDynamicClient, got %T", client.Dynamic)
	}
	dyn.PrependReactor("delete", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "", Resource: "pods"}, "locked", nil)
	})

	_, router := newMutationTestHandler(t, client, clusterID)

	req := httptest.NewRequest(http.MethodDelete,
		"/api/v1/clusters/"+clusterID+"/resources/pods/default/locked", nil)
	req.Header.Set(DestructiveConfirmHeader, "true")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a Forbidden delete, got %d: %s", rec.Code, rec.Body.String())
	}

	// The object must still exist — a permission-denied response must not
	// have silently deleted anything.
	if _, err := client.GetResource(req.Context(), "pods", "default", "locked"); err != nil {
		t.Errorf("expected pod to still exist after a Forbidden delete, GetResource failed: %v", err)
	}
}

// TestPatchResource_Pod verifies PatchResource works for a second resource
// kind beyond the Deployment case in resources_mutation_test.go, since the
// GVK resolution it shares with DeleteResource is exactly what a regression
// would silently break for one kind only.
func TestPatchResource_Pod(t *testing.T) {
	clusterID := "test-cluster"
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-0", Namespace: "default", Labels: map[string]string{"tier": "old"}},
	}
	client := newMutableTestClient(t, toUnstructuredPod(pod))
	_, router := newMutationTestHandler(t, client, clusterID)

	body := strings.NewReader(`{"metadata":{"labels":{"tier":"new"}}}`)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/clusters/"+clusterID+"/resources/pods/default/web-0", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	got, err := client.GetResource(req.Context(), "pods", "default", "web-0")
	if err != nil {
		t.Fatalf("GetResource after patch: %v", err)
	}
	labels := got.GetLabels()
	if labels["tier"] != "new" {
		t.Errorf("expected persisted label tier=new, got %q", labels["tier"])
	}
}

// TestPatchResource_Forbidden covers PatchResource's RBAC/permission-denied
// path, mirroring TestDeleteResource_Forbidden.
func TestPatchResource_Forbidden(t *testing.T) {
	clusterID := "test-cluster"
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}}
	client := newMutableTestClient(t, toUnstructuredDeployment(deployment))

	dyn, ok := client.Dynamic.(*dynamicfake.FakeDynamicClient)
	if !ok {
		t.Fatalf("expected client.Dynamic to be a *dynamicfake.FakeDynamicClient, got %T", client.Dynamic)
	}
	dyn.PrependReactor("patch", "deployments", func(action ktesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "apps", Resource: "deployments"}, "web", nil)
	})

	_, router := newMutationTestHandler(t, client, clusterID)

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/clusters/"+clusterID+"/resources/deployments/default/web",
		strings.NewReader(`{"spec":{"replicas":9}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a Forbidden patch, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestApplyManifest_MultipleKinds verifies ApplyManifest's create path for a
// second resource kind beyond the Pod/ConfigMap cases in
// resources_mutation_test.go.
func TestApplyManifest_MultipleKinds(t *testing.T) {
	clusterID := "test-cluster"
	client := newMutableTestClient(t) // empty cluster
	_, router := newMutationTestHandler(t, client, clusterID)

	yamlManifest := "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: fresh-deploy\n  namespace: default\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: fresh\n  template:\n    metadata:\n      labels:\n        app: fresh\n    spec:\n      containers:\n      - name: c\n        image: nginx\n"
	reqBody, err := json.Marshal(map[string]string{"yaml": yamlManifest})
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterID+"/apply", strings.NewReader(string(reqBody)))
	req.Header.Set(DestructiveConfirmHeader, "true")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := client.GetResource(req.Context(), "deployments", "default", "fresh-deploy"); err != nil {
		t.Errorf("expected applied deployment to exist, GetResource failed: %v", err)
	}
}

// TestApplyManifest_InvalidBody covers the invalid-request-body path
// (malformed JSON envelope, as opposed to invalid YAML inside a valid JSON
// envelope, which resources_mutation_test.go's
// TestHandler_ApplyManifest_InvalidYAML already covers).
func TestApplyManifest_InvalidBody(t *testing.T) {
	clusterID := "test-cluster"
	client := newMutableTestClient(t)
	_, router := newMutationTestHandler(t, client, clusterID)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterID+"/apply", strings.NewReader(`not json at all`))
	req.Header.Set(DestructiveConfirmHeader, "true")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for a malformed request body, got %d: %s", rec.Code, rec.Body.String())
	}
}
