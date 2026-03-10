package handler

import (
	"net/http"
	"time"

	"clawx-backend/internal/model"
	"clawx-backend/internal/service/llm"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type LLMProxyHandler struct {
	registry       *llm.ProviderRegistry
	proxyService   *llm.ProxyService
	streamService  *llm.StreamProxyService
	usageCollector *llm.UsageCollector
	logger         *zap.Logger
}

func NewLLMProxyHandler(
	registry *llm.ProviderRegistry,
	proxyService *llm.ProxyService,
	streamService *llm.StreamProxyService,
	usageCollector *llm.UsageCollector,
	logger *zap.Logger,
) *LLMProxyHandler {
	return &LLMProxyHandler{
		registry:       registry,
		proxyService:   proxyService,
		streamService:  streamService,
		usageCollector: usageCollector,
		logger:         logger,
	}
}

func (h *LLMProxyHandler) ChatCompletions(c *gin.Context) {
	var req llm.ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	providerHeader := c.GetHeader("X-Provider")
	modelHeader := c.GetHeader("X-Model")
	if modelHeader != "" && req.Model == "" {
		req.Model = modelHeader
	}

	provider, err := h.registry.Resolve(providerHeader, req.Model)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Stream {
		h.handleStream(c, provider, req)
		return
	}
	h.handleNonStream(c, provider, req)
}

func (h *LLMProxyHandler) handleNonStream(c *gin.Context, provider *llm.ProviderConfig, req llm.ChatRequest) {
	resp, err := h.proxyService.ForwardNonStream(c.Request.Context(), provider, req)
	if err != nil {
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": err.Error()})
		return
	}

	userID, _ := c.Get("user_id")
	h.usageCollector.Record(model.UsageRecord{
		RequestID:    "mock-non-stream",
		UserID:       toString(userID),
		Provider:     provider.Name,
		Model:        req.Model,
		InputTokens:  12,
		OutputTokens: 18,
		TotalTokens:  30,
		CreatedAt:    time.Now(),
	})

	c.JSON(resp.StatusCode, resp.Body)
}

func (h *LLMProxyHandler) handleStream(c *gin.Context, provider *llm.ProviderConfig, req llm.ChatRequest) {
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "stream not supported"})
		return
	}

	ch, err := h.streamService.ForwardStream(c.Request.Context(), provider, req)
	if err != nil {
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": err.Error()})
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	for chunk := range ch {
		_, writeErr := c.Writer.Write([]byte(chunk.Data))
		if writeErr != nil {
			h.logger.Warn("stream write failed", zap.Error(writeErr))
			return
		}
		flusher.Flush()
	}
}

func toString(v any) string {
	s, ok := v.(string)
	if ok {
		return s
	}
	return ""
}
