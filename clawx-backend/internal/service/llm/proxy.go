package llm

import (
	"context"
	"errors"
	"time"
)

type ProxyService struct {
	timeout time.Duration
}

func NewProxyService(timeout time.Duration) *ProxyService {
	return &ProxyService{timeout: timeout}
}

func (s *ProxyService) ForwardNonStream(
	ctx context.Context,
	provider *ProviderConfig,
	request ChatRequest,
) (*UpstreamResponse, error) {
	if provider == nil {
		return nil, errors.New("provider is required")
	}

	_, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// Phase 2 pre-development mock implementation.
	body := map[string]any{
		"id":      "mock-chat-completion",
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   request.Model,
		"choices": []map[string]any{
			{
				"index": 0,
				"message": map[string]string{
					"role":    "assistant",
					"content": "This is a mock response from clawx-backend pre-development scaffold.",
				},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]int{
			"prompt_tokens":     12,
			"completion_tokens": 18,
			"total_tokens":      30,
		},
		"provider": provider.Name,
	}
	return &UpstreamResponse{
		StatusCode: 200,
		Body:       body,
	}, nil
}
