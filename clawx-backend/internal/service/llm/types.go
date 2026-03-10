package llm

type ChatRequest struct {
	Messages []map[string]any `json:"messages"`
	Stream   bool             `json:"stream"`
	Model    string           `json:"model,omitempty"`
}

type ProviderConfig struct {
	Name    string
	APIKey  string
	BaseURL string
}

type UpstreamResponse struct {
	StatusCode int
	Body       any
}
