# clawx-backend (Phase 2 pre-development scaffold)

This directory contains a pre-development scaffold for the Phase 2 LLM proxy backend.

## Included now

- Gin server bootstrap in `cmd/server/main.go`
- Config loading from YAML in `internal/config/config.go`
- Health endpoints:
  - `GET /health`
  - `GET /ready`
- Mock auth middleware for Phase 1 dependency simulation
  - accepts `Authorization: Bearer mock.jwt.*`
- LLM proxy endpoints (mock implementation)
  - `POST /api/v1/llm/chat/completions`
  - supports non-stream and SSE stream mock responses
- Usage collector and pricing service structure

## Run locally

```bash
cd clawx-backend
go mod tidy
go run ./cmd/server
```

## Test quickly

```bash
curl http://127.0.0.1:9090/health

curl -X POST http://127.0.0.1:9090/api/v1/llm/chat/completions \
  -H "Authorization: Bearer mock.jwt.12345" \
  -H "Content-Type: application/json" \
  -H "X-Provider: openai" \
  -H "X-Model: gpt-4o" \
  -d '{"messages":[{"role":"user","content":"hello"}],"stream":false}'
```
