package llm

import (
	"clawx-backend/internal/model"
	"clawx-backend/internal/service/billing"
	"clawx-backend/internal/service/pricing"
	"context"
	"fmt"
	"strings"
	"time"

	"go.uber.org/zap"
)

type UsageCollector struct {
	logger            *zap.Logger
	billingClient     *billing.BillingClient
	pricingService    *pricing.Service
	invalidateBalance func(string)
}

func NewUsageCollector(
	logger *zap.Logger,
	billingClient *billing.BillingClient,
	pricingService *pricing.Service,
	invalidateBalance func(string),
) *UsageCollector {
	return &UsageCollector{
		logger:            logger,
		billingClient:     billingClient,
		pricingService:    pricingService,
		invalidateBalance: invalidateBalance,
	}
}

func (c *UsageCollector) Record(record model.UsageRecord) {
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}
	if record.TotalTokens <= 0 {
		record.TotalTokens = record.InputTokens + record.OutputTokens
	}
	if c.pricingService != nil {
		usage := pricing.UsageInput{
			InputTokens:  record.InputTokens,
			OutputTokens: record.OutputTokens,
		}
		record.CostUSD = c.pricingService.CalculateCostUSD(record.Provider, record.Model, usage)
		record.Points = c.pricingService.CalculatePointsFromCost(record.CostUSD)
	}

	c.logger.Info("llm usage",
		zap.String("request_id", record.RequestID),
		zap.String("user_id", record.UserID),
		zap.String("provider", record.Provider),
		zap.String("model", record.Model),
		zap.Int("input_tokens", record.InputTokens),
		zap.Int("output_tokens", record.OutputTokens),
		zap.Int("total_tokens", record.TotalTokens),
		zap.Float64("cost_usd", record.CostUSD),
		zap.Int("points", record.Points),
	)

	if c.billingClient == nil || c.pricingService == nil || record.UserID == "" || record.Points <= 0 {
		return
	}

	remark := fmt.Sprintf("%s | in:%d out:%d", record.Model, record.InputTokens, record.OutputTokens)
	c.deductWithRetry(record, remark)
}

func (c *UsageCollector) deductWithRetry(record model.UsageRecord, remark string) {
	backoffs := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}
	ownerID := billing.BuildUserOwnerID(record.UserID)
	if ownerID == "" {
		c.logger.Warn("llm usage deduct skipped due to empty owner id",
			zap.String("request_id", record.RequestID),
			zap.String("user_id", record.UserID),
		)
		return
	}
	bizID := strings.TrimSpace(record.RequestID)
	if bizID == "" {
		bizID = fmt.Sprintf("llm_usage_%s_%d_%d", strings.TrimSpace(record.UserID), record.CreatedAt.UnixNano(), record.TotalTokens)
	}
	idempotentKey := fmt.Sprintf("llm_%s", bizID)
	req := &billing.DeductRequest{
		OwnerID:       ownerID,
		OwnerType:     "user",
		UserID:        record.UserID,
		Amount:        record.Points,
		BizType:       "llm_usage",
		BizID:         bizID,
		Remark:        remark,
		IdempotentKey: idempotentKey,
	}
	idempotentFallbackUsed := false
	var lastErr error
	for index, backoff := range backoffs {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := c.billingClient.DeductPoints(ctx, req)
		cancel()
		if err == nil {
			if c.invalidateBalance != nil {
				c.invalidateBalance(record.UserID)
			}
			c.logger.Info("llm usage deducted",
				zap.String("request_id", record.RequestID),
				zap.String("user_id", record.UserID),
				zap.Int("points", record.Points),
			)
			return
		}

		lastErr = err
		if apiErr, ok := err.(*billing.APIError); ok {
			if !idempotentFallbackUsed && apiErr.Code == 50004 && strings.Contains(strings.ToLower(apiErr.Message), "idempotent check failed") {
				idempotentFallbackUsed = true
				// Keep idempotency enabled and rotate to a deterministic fallback key,
				// so we never trigger downstream empty-idempotent uniqueness issues.
				req.IdempotentKey = fmt.Sprintf("%s_retry", idempotentKey)
				c.logger.Warn("llm usage deduct idempotent fallback",
					zap.String("request_id", record.RequestID),
					zap.String("user_id", record.UserID),
					zap.Error(err),
				)
				continue
			}
		}
		c.logger.Warn("llm usage deduct failed",
			zap.String("request_id", record.RequestID),
			zap.String("user_id", record.UserID),
			zap.Int("attempt", index+1),
			zap.Error(err),
		)
		time.Sleep(backoff)
	}

	c.logger.Error("llm usage deduct exhausted retries",
		zap.String("request_id", record.RequestID),
		zap.String("user_id", record.UserID),
		zap.Int("points", record.Points),
		zap.Error(lastErr),
	)
}
