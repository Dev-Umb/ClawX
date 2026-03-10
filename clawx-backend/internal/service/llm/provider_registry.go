package llm

import (
	"fmt"
	"strings"

	"clawx-backend/internal/config"
)

type ProviderRegistry struct {
	providers map[string]*ProviderConfig
}

func NewProviderRegistry(cfg map[string]config.ProviderConfig) *ProviderRegistry {
	providers := make(map[string]*ProviderConfig, len(cfg))
	for name, provider := range cfg {
		providers[name] = &ProviderConfig{
			Name:    name,
			APIKey:  provider.APIKey,
			BaseURL: strings.TrimRight(provider.BaseURL, "/"),
		}
	}
	return &ProviderRegistry{providers: providers}
}

func (r *ProviderRegistry) Resolve(provider, model string) (*ProviderConfig, error) {
	if provider != "" {
		if resolved, ok := r.providers[provider]; ok {
			return resolved, nil
		}
		return nil, fmt.Errorf("provider %s not configured", provider)
	}

	inferred := inferProviderByModel(model)
	if inferred == "" {
		return nil, fmt.Errorf("cannot infer provider by model: %s", model)
	}
	resolved, ok := r.providers[inferred]
	if !ok {
		return nil, fmt.Errorf("inferred provider %s not configured", inferred)
	}
	return resolved, nil
}

func inferProviderByModel(model string) string {
	switch {
	case strings.HasPrefix(model, "gpt-"), strings.HasPrefix(model, "o1-"), strings.HasPrefix(model, "o3-"):
		return "openai"
	case strings.HasPrefix(model, "claude-"):
		return "anthropic"
	case strings.HasPrefix(model, "gemini-"):
		return "google"
	case strings.HasPrefix(model, "ep-"), strings.HasPrefix(model, "doubao-"):
		return "ark"
	case strings.HasPrefix(model, "moonshot-"):
		return "moonshot"
	default:
		return ""
	}
}
