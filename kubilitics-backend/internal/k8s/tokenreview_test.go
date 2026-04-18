package k8s

import (
	"context"
	"testing"

	authv1 "k8s.io/api/authentication/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestReviewSAToken_Authenticated(t *testing.T) {
	cs := fake.NewSimpleClientset()
	cs.PrependReactor("create", "tokenreviews", func(a ktesting.Action) (bool, runtime.Object, error) {
		return true, &authv1.TokenReview{
			ObjectMeta: metav1.ObjectMeta{Name: "tr"},
			Status: authv1.TokenReviewStatus{
				Authenticated: true,
				User:          authv1.UserInfo{Username: "system:serviceaccount:kubilitics-system:agent"},
			},
		}, nil
	})
	rev := NewTokenReviewer(cs)
	got, err := rev.Review(context.Background(), "any-token")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Authenticated || got.Username != "system:serviceaccount:kubilitics-system:agent" {
		t.Fatalf("got %+v", got)
	}
}

func TestReviewSAToken_Unauthenticated(t *testing.T) {
	cs := fake.NewSimpleClientset()
	cs.PrependReactor("create", "tokenreviews", func(a ktesting.Action) (bool, runtime.Object, error) {
		return true, &authv1.TokenReview{Status: authv1.TokenReviewStatus{Authenticated: false}}, nil
	})
	rev := NewTokenReviewer(cs)
	got, _ := rev.Review(context.Background(), "bad")
	if got.Authenticated {
		t.Fatal("expected not authenticated")
	}
}
