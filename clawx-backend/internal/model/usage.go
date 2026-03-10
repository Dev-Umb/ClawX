package model

import "time"

type UsageRecord struct {
	RequestID    string    `json:"request_id"`
	UserID       string    `json:"user_id"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	InputTokens  int       `json:"input_tokens"`
	OutputTokens int       `json:"output_tokens"`
	CacheRead    int       `json:"cache_read_tokens"`
	CacheWrite   int       `json:"cache_write_tokens"`
	TotalTokens  int       `json:"total_tokens"`
	CostUSD      float64   `json:"cost_usd"`
	Points       int       `json:"points"`
	CreatedAt    time.Time `json:"created_at"`
}
