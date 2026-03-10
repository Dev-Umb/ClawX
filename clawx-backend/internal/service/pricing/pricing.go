package pricing

import (
	"math"
	"strings"
)

type UsageInput struct {
	InputTokens  int
	OutputTokens int
}

type Service struct {
	table PricingTable
}

func NewService(table PricingTable) *Service {
	return &Service{table: table}
}

func (s *Service) CalculatePoints(provider, model string, usage UsageInput) int {
	pricing := s.findPricing(provider, model)
	costUSD := float64(usage.InputTokens)*pricing.InputPer1M/1_000_000 +
		float64(usage.OutputTokens)*pricing.OutputPer1M/1_000_000
	return int(math.Ceil(costUSD * 100 * s.table.PointsPerCent))
}

func (s *Service) findPricing(provider, model string) ModelPricing {
	for _, item := range s.table.Models {
		if item.Provider != provider {
			continue
		}
		if item.Model == model {
			return item
		}
		if strings.HasSuffix(item.Model, "*") && strings.HasPrefix(model, strings.TrimSuffix(item.Model, "*")) {
			return item
		}
	}
	return s.table.Default
}
