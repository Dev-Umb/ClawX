package llm

import (
	"clawx-backend/internal/model"
	"go.uber.org/zap"
)

type UsageCollector struct {
	logger *zap.Logger
}

func NewUsageCollector(logger *zap.Logger) *UsageCollector {
	return &UsageCollector{logger: logger}
}

func (c *UsageCollector) Record(record model.UsageRecord) {
	// Phase 2 pre-development: log usage only; billing integration comes later.
	c.logger.Info("llm usage",
		zap.String("request_id", record.RequestID),
		zap.String("user_id", record.UserID),
		zap.String("provider", record.Provider),
		zap.String("model", record.Model),
		zap.Int("input_tokens", record.InputTokens),
		zap.Int("output_tokens", record.OutputTokens),
		zap.Int("total_tokens", record.TotalTokens),
	)
}
