package k8s

import (
	"context"

	authv1 "k8s.io/api/authentication/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// TokenReviewer validates ServiceAccount JWTs via the Kubernetes TokenReview API.
type TokenReviewer struct{ cs kubernetes.Interface }

// NewTokenReviewer returns a TokenReviewer backed by the given clientset.
func NewTokenReviewer(cs kubernetes.Interface) *TokenReviewer { return &TokenReviewer{cs: cs} }

// ReviewResult holds the outcome of a TokenReview call.
type ReviewResult struct {
	Authenticated bool
	Username      string
	UID           string
	Groups        []string
}

// Review submits token to the K8s API server and returns the authentication result.
func (r *TokenReviewer) Review(ctx context.Context, token string) (ReviewResult, error) {
	tr := &authv1.TokenReview{
		ObjectMeta: metav1.ObjectMeta{},
		Spec:       authv1.TokenReviewSpec{Token: token},
	}
	resp, err := r.cs.AuthenticationV1().TokenReviews().Create(ctx, tr, metav1.CreateOptions{})
	if err != nil {
		return ReviewResult{}, err
	}
	return ReviewResult{
		Authenticated: resp.Status.Authenticated,
		Username:      resp.Status.User.Username,
		UID:           resp.Status.User.UID,
		Groups:        resp.Status.User.Groups,
	}, nil
}
