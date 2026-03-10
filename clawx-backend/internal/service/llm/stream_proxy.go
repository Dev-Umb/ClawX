package llm

import (
	"context"
	"fmt"
	"time"
)

type StreamChunk struct {
	Data string
	Done bool
}

type StreamProxyService struct {
	timeout time.Duration
}

func NewStreamProxyService(timeout time.Duration) *StreamProxyService {
	return &StreamProxyService{timeout: timeout}
}

func (s *StreamProxyService) ForwardStream(
	ctx context.Context,
	provider *ProviderConfig,
	request ChatRequest,
) (<-chan StreamChunk, error) {
	_ = request

	ch := make(chan StreamChunk, 3)
	ctx, cancel := context.WithTimeout(ctx, s.timeout)

	go func() {
		defer close(ch)
		defer cancel()

		select {
		case <-ctx.Done():
			return
		case ch <- StreamChunk{Data: fmt.Sprintf("data: {\"provider\":\"%s\",\"delta\":\"hello\"}\n\n", provider.Name)}:
		}

		select {
		case <-ctx.Done():
			return
		case ch <- StreamChunk{Data: "data: {\"delta\":\" world\"}\n\n"}:
		}

		select {
		case <-ctx.Done():
			return
		case ch <- StreamChunk{Data: "data: [DONE]\n\n", Done: true}:
		}
	}()

	return ch, nil
}
