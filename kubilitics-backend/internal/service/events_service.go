package service

import (
	"context"
	"fmt"
	"sort"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EventsService provides access to Kubernetes events
type EventsService interface {
	ListEvents(ctx context.Context, clusterID, namespace string, limit int) ([]*models.Event, error)
	ListEventsAllNamespaces(ctx context.Context, clusterID string, limit int) ([]*models.Event, error)
	GetResourceEvents(ctx context.Context, clusterID, namespace, resourceKind, resourceName string) ([]*models.Event, error)
	WatchEvents(ctx context.Context, clusterID, namespace string, eventChan chan<- *models.Event, errChan chan<- error)
}

type eventsService struct {
	clusterService *clusterService
}

// NewEventsService creates a new events service
func NewEventsService(cs ClusterService) EventsService {
	return &eventsService{
		clusterService: cs.(*clusterService),
	}
}

func (s *eventsService) ListEvents(ctx context.Context, clusterID, namespace string, limit int) ([]*models.Event, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	listOpts := metav1.ListOptions{}
	if limit > 0 {
		listOpts.Limit = int64(limit)
	}

	eventList, err := client.Clientset.CoreV1().Events(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to list events: %w", err)
	}

	events := make([]*models.Event, 0, len(eventList.Items))
	for _, event := range eventList.Items {
		events = append(events, k8sEventToModel(&event))
	}

	return events, nil
}

// ListEventsAllNamespaces lists events from all namespaces, merged and sorted by LastTimestamp descending, limited to limit.
func (s *eventsService) ListEventsAllNamespaces(ctx context.Context, clusterID string, limit int) ([]*models.Event, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	nsList, err := client.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list namespaces: %w", err)
	}

	perNamespaceLimit := 100
	if limit > 0 && len(nsList.Items) > 0 {
		perNamespaceLimit = (limit / len(nsList.Items)) + 50
		if perNamespaceLimit < 20 {
			perNamespaceLimit = 20
		}
	}

	var all []*models.Event
	for _, ns := range nsList.Items {
		listOpts := metav1.ListOptions{}
		if perNamespaceLimit > 0 {
			listOpts.Limit = int64(perNamespaceLimit)
		}
		eventList, err := client.Clientset.CoreV1().Events(ns.Name).List(ctx, listOpts)
		if err != nil {
			continue
		}
		for i := range eventList.Items {
			all = append(all, k8sEventToModel(&eventList.Items[i]))
		}
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].LastTimestamp.After(all[j].LastTimestamp)
	})
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

func k8sEventToModel(event *corev1.Event) *models.Event {
	sourceComponent := ""
	if event.Source.Component != "" {
		sourceComponent = event.Source.Component
	}
	return &models.Event{
		ID:               string(event.UID),
		Name:             event.Name,
		EventNamespace:   event.Namespace,
		Type:             event.Type,
		Reason:           event.Reason,
		Message:          event.Message,
		ResourceKind:     event.InvolvedObject.Kind,
		ResourceName:     event.InvolvedObject.Name,
		Namespace:        event.InvolvedObject.Namespace,
		FirstTimestamp:   event.FirstTimestamp.Time,
		LastTimestamp:    event.LastTimestamp.Time,
		Count:            event.Count,
		SourceComponent:  sourceComponent,
	}
}

func (s *eventsService) GetResourceEvents(ctx context.Context, clusterID, namespace, resourceKind, resourceName string) ([]*models.Event, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	fieldSelector := fmt.Sprintf("involvedObject.kind=%s,involvedObject.name=%s", resourceKind, resourceName)
	listOpts := metav1.ListOptions{
		FieldSelector: fieldSelector,
	}

	eventList, err := client.Clientset.CoreV1().Events(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to list resource events: %w", err)
	}

	events := make([]*models.Event, 0, len(eventList.Items))
	for i := range eventList.Items {
		events = append(events, k8sEventToModel(&eventList.Items[i]))
	}

	return events, nil
}

func (s *eventsService) WatchEvents(ctx context.Context, clusterID, namespace string, eventChan chan<- *models.Event, errChan chan<- error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		errChan <- err
		return
	}

	watcher, err := client.Clientset.CoreV1().Events(namespace).Watch(ctx, metav1.ListOptions{})
	if err != nil {
		errChan <- fmt.Errorf("failed to watch events: %w", err)
		return
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return
			}

			if k8sEvent, ok := event.Object.(*corev1.Event); ok {
				eventChan <- k8sEventToModel(k8sEvent)
			}
		}
	}
}
