# Phase 2：后端 LLM 代理服务

> 预估周期：2~2.5 周
> 前置依赖：Phase 1（SSO 登录）完成
> 涉及仓库：ClawX、ClawX Backend（新建）

---

## 目标

搭建 ClawX Backend 服务，代理所有大模型请求。前端用户无需配置任何 API Key，登录后即可使用。同时保留本地模式向后兼容。

---

## Story 列表

| ID | Story | 优先级 | 预估 |
|----|-------|--------|------|
| P2.S1 | ClawX Backend 项目初始化 | P0 | 1d |
| P2.S2 | JWT 认证中间件 | P0 | 1d |
| P2.S3 | Provider 密钥管理与路由 | P0 | 1d |
| P2.S4 | LLM Proxy 核心 — 非 Streaming 请求 | P0 | 1d |
| P2.S5 | LLM Proxy 核心 — SSE Streaming 转发 | P0 | 2d |
| P2.S6 | Usage 采集与日志记录 | P0 | 1d |
| P2.S7 | 模型定价表配置 | P1 | 0.5d |
| P2.S8 | 前端 `clawx-cloud` Provider 类型 | P0 | 1d |
| P2.S9 | 服务模式切换 UI | P0 | 1d |
| P2.S10 | 登录后自动注入云端 Provider | P0 | 1d |
| P2.S11 | Backend 部署与健康检查 | P1 | 0.5d |

---

## P2.S1 — ClawX Backend 项目初始化

### 描述

新建 Go 项目 `clawx-backend`，搭建基础框架。

### 产出

新建独立仓库或目录，初始结构：

```
clawx-backend/
├── cmd/server/main.go
├── internal/
│   ├── config/config.go
│   ├── handler/
│   ├── middleware/
│   ├── service/
│   └── model/
├── configs/config.yaml
├── Dockerfile
├── docker-compose.yaml
├── go.mod
├── go.sum
└── README.md
```

### 技术选型

| 项 | 选择 |
|----|------|
| 语言 | Go 1.22+ |
| Web 框架 | Gin |
| 配置 | Viper (YAML + ENV) |
| 日志 | Zap |
| HTTP Client | net/http（标准库） |

### config.yaml 基本结构

```yaml
server:
  port: 9090
  mode: release          # debug / release

auth:
  sso_check_jwt_url: "http://sureup-laravel/api/v1/internal/checkjwt"
  internal_token: "${INTERNAL_SERVICE_TOKEN}"

billing:
  base_url: "http://billing-service:9988"

providers:
  openai:
    api_key: "${OPENAI_API_KEY}"
    base_url: "https://api.openai.com/v1"
  anthropic:
    api_key: "${ANTHROPIC_API_KEY}"
    base_url: "https://api.anthropic.com/v1"
  google:
    api_key: "${GOOGLE_API_KEY}"
    base_url: "https://generativelanguage.googleapis.com/v1beta"
  ark:
    api_key: "${ARK_API_KEY}"
    base_url: "https://ark.cn-beijing.volces.com/api/v3"

logging:
  level: info
```

### 验收标准

- [AC-2101] `go build ./cmd/server` 成功
- [AC-2102] `go run ./cmd/server` 启动后 `GET /health` 返回 200
- [AC-2103] Docker build + run 正常
- [AC-2104] Viper 能从 YAML + ENV 正确加载配置

---

## P2.S2 — JWT 认证中间件

### 描述

实现 Gin 中间件，校验请求中的 JWT Token，确认用户身份。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/middleware/auth.go` | 新增 |
| `internal/model/user.go` | 新增 — User 结构体 |

### 实现方式

**方案：调用 sureup_laravel Internal API 校验**

```
1. 从 Authorization: Bearer <token> 提取 JWT
2. POST sureup_laravel /api/v1/internal/checkjwt
   Headers: { Authorization: Bearer <INTERNAL_SERVICE_TOKEN> }
   Body: { token: <user_jwt> }
3. 成功 → 解析返回的 user_id, email, name 等
4. 写入 gin.Context: c.Set("user_id", userId)
5. 失败 → 返回 401
```

### 缓存优化

JWT 校验结果可短期缓存（如 30s），减少对 sureup_laravel 的调用压力：

```go
type jwtCacheEntry struct {
    userID    string
    expiresAt time.Time
}
var jwtCache sync.Map // map[tokenHash]jwtCacheEntry
```

### 验收标准

- [AC-2201] 无 Authorization header 的请求返回 401
- [AC-2202] 无效/过期 JWT 返回 401
- [AC-2203] 有效 JWT 正确解析 user_id，请求通过
- [AC-2204] sureup_laravel 不可达时返回 503（非 panic）
- [AC-2205] 缓存命中时不再调用 sureup_laravel

---

## P2.S3 — Provider 密钥管理与路由

### 描述

管理各 LLM Provider 的 API Key 和 Base URL，根据请求中的 provider/model 信息路由到对应上游。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/service/llm/provider_registry.go` | 新增 |
| `internal/service/llm/types.go` | 新增 |
| `internal/config/config.go` | 修改 — providers 配置结构 |

### 核心结构

```go
type ProviderConfig struct {
    Name    string
    APIKey  string
    BaseURL string
}

type ProviderRegistry struct {
    providers map[string]*ProviderConfig
}

func (r *ProviderRegistry) Resolve(provider, model string) (*ProviderConfig, error)
```

### 路由规则

1. 请求 Header `X-Provider` 指定 provider（如 `openai`, `anthropic`）
2. 请求 Header `X-Model` 指定 model（如 `gpt-4o`）
3. 若未指定 `X-Provider`，根据 model 名称前缀自动推断
4. Provider 不存在 → 返回 400

### 模型前缀推断表

| 前缀 | Provider |
|------|----------|
| `gpt-` / `o1-` / `o3-` | openai |
| `claude-` | anthropic |
| `gemini-` | google |
| `ep-` / `doubao-` | ark |
| `moonshot-` | moonshot |

### 验收标准

- [AC-2301] 已配置的 provider 能正确 resolve
- [AC-2302] 未配置的 provider 返回清晰错误
- [AC-2303] 模型前缀推断覆盖主流模型
- [AC-2304] API Key 不会出现在任何日志或响应中

---

## P2.S4 — LLM Proxy 核心（非 Streaming）

### 描述

实现 LLM API 的非 Streaming 代理转发。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/handler/llm_proxy.go` | 新增 |
| `internal/service/llm/proxy.go` | 新增 |

### 接口

```
POST /api/v1/llm/chat/completions
Authorization: Bearer <user_jwt>
X-Provider: openai
X-Model: gpt-4o
Content-Type: application/json

{ "messages": [...], "stream": false, ... }
```

### 处理流程

```
1. Auth 中间件校验 JWT → user_id
2. 解析 X-Provider / X-Model → 找到上游配置
3. 构造上游请求：
   - URL: {baseUrl}/chat/completions
   - Authorization: Bearer {server_api_key}
   - Body: 原样透传
4. 发送请求到上游
5. 返回上游响应给客户端
6. 解析 response.usage 记录消耗（异步）
```

### 验收标准

- [AC-2401] 非 Streaming 请求正确转发并返回
- [AC-2402] 上游 API Key 不会泄露给客户端
- [AC-2403] 上游返回错误时正确透传错误码和消息
- [AC-2404] 请求超时（默认 120s）后返回 504

---

## P2.S5 — LLM Proxy 核心（SSE Streaming）

### 描述

实现 SSE Streaming 模式的 LLM 代理转发，这是最核心也最复杂的部分。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/handler/llm_proxy.go` | 修改 — stream 分支 |
| `internal/service/llm/stream_proxy.go` | 新增 |

### 处理流程

```
1. 检测请求 body 中 "stream": true
2. 设置响应 headers:
   Content-Type: text/event-stream
   Cache-Control: no-cache
   Connection: keep-alive
   X-Accel-Buffering: no
3. 建立到上游的 HTTP 请求
4. 逐 chunk 读取上游 SSE 响应并转发给客户端：
   - 使用 bufio.Scanner 按行读取
   - 遇到 "data: " 前缀的行直接写入 response
   - Flush 每个 chunk
5. 在最后一个 data chunk（或 "data: [DONE]" 之前的 chunk）中
   解析 usage 字段
6. Stream 结束后，异步记录 usage
```

### 关键技术点

- **Flusher**：必须使用 `http.Flusher` 在每个 chunk 后 flush
- **超时**：使用 context.WithTimeout，默认 300s（长对话场景）
- **客户端断开**：监听 `request.Context().Done()`，及时关闭上游连接
- **Usage 提取**：OpenAI/Anthropic 的最后一个 chunk 包含 usage 信息

### Anthropic 特殊处理

Anthropic API 格式与 OpenAI 不同：
- 使用 `x-api-key` header（非 Bearer）
- SSE 事件格式为 `event: message_start` / `event: content_block_delta` 等
- Usage 在 `message_start` 和 `message_delta` 事件中

需要在 proxy 层做 provider-specific 适配。

### 验收标准

- [AC-2501] Streaming 响应首 token 延迟 < 直接调用延迟 + 50ms
- [AC-2502] 长对话（>100 chunks）稳定传输无断流
- [AC-2503] 客户端主动断开后上游连接及时关闭
- [AC-2504] 支持 OpenAI + Anthropic 两种 SSE 格式
- [AC-2505] 能正确提取各 provider 的 usage 信息
- [AC-2506] Nginx/CDN 层不会 buffer SSE（需要 `X-Accel-Buffering: no`）

---

## P2.S6 — Usage 采集与日志记录

### 描述

每次 LLM 请求完成后，采集 token 用量并记录，供后续 Phase 3 计费使用。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/service/llm/usage_collector.go` | 新增 |
| `internal/model/usage.go` | 新增 |

### Usage 数据结构

```go
type UsageRecord struct {
    RequestID     string    `json:"request_id"`
    UserID        string    `json:"user_id"`
    Provider      string    `json:"provider"`
    Model         string    `json:"model"`
    InputTokens   int       `json:"input_tokens"`
    OutputTokens  int       `json:"output_tokens"`
    CacheRead     int       `json:"cache_read_tokens"`
    CacheWrite    int       `json:"cache_write_tokens"`
    TotalTokens   int       `json:"total_tokens"`
    CostUSD       float64   `json:"cost_usd"`
    Points        int       `json:"points"`
    CreatedAt     time.Time `json:"created_at"`
}
```

### 采集方式

1. 非 Streaming：直接从 response body 解析 `usage` 字段
2. Streaming：从最后一个 data chunk 中提取（OpenAI 会在 `stream_options.include_usage: true` 时返回）

### 日志记录（Phase 2 先做日志，Phase 3 接入扣费）

- 结构化日志（Zap）写入 usage 记录
- 后续 Phase 3 将在此基础上增加 billing deduct 调用

### 验收标准

- [AC-2601] 每次 LLM 请求完成后产生一条 usage 日志
- [AC-2602] 日志包含 user_id, provider, model, input/output tokens
- [AC-2603] Streaming 请求也能正确采集 usage
- [AC-2604] Usage 采集失败不影响主请求

---

## P2.S7 — 模型定价表配置

### 描述

维护各模型的 token 定价信息，供计费使用。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/service/pricing/pricing.go` | 新增 |
| `internal/service/pricing/pricing_table.go` | 新增 |
| `configs/pricing.yaml` | 新增 |

### 定价配置格式

```yaml
# configs/pricing.yaml
points_per_cent: 1.0  # 1 美分 = 1 积分

models:
  - provider: openai
    model: "gpt-4o"
    input_per_1m: 2.50
    output_per_1m: 10.00
  - provider: openai
    model: "gpt-4o-mini"
    input_per_1m: 0.15
    output_per_1m: 0.60
  - provider: anthropic
    model: "claude-sonnet-4-20250514"
    input_per_1m: 3.00
    output_per_1m: 15.00
  - provider: anthropic
    model: "claude-3-5-haiku-20241022"
    input_per_1m: 0.80
    output_per_1m: 4.00
  - provider: google
    model: "gemini-2.0-flash"
    input_per_1m: 0.10
    output_per_1m: 0.40
  - provider: ark
    model: "ep-*"           # 通配符匹配
    input_per_1m: 0.80
    output_per_1m: 2.00

  # 未匹配模型的默认定价
  default:
    input_per_1m: 3.00
    output_per_1m: 15.00
```

### 积分计算

```go
func (p *PricingService) Calculate(provider, model string, usage UsageRecord) int {
    pricing := p.findPricing(provider, model)
    costUSD := float64(usage.InputTokens)*pricing.InputPer1M/1_000_000 +
               float64(usage.OutputTokens)*pricing.OutputPer1M/1_000_000
    points := int(math.Ceil(costUSD * 100 * p.config.PointsPerCent))
    return points
}
```

### 验收标准

- [AC-2701] 已配置模型能查到正确定价
- [AC-2702] 未配置模型使用 default 定价
- [AC-2703] 通配符匹配（如 `ep-*`）正常工作
- [AC-2704] 定价热更新（修改 yaml 后 reload，不需重启）为 P2 可选

---

## P2.S8 — 前端 `clawx-cloud` Provider 类型

### 描述

在 ClawX 前端新增 `clawx-cloud` Provider 类型，指向 ClawX Backend 代理。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/lib/providers.ts` | 修改 — 新增 provider type |
| ClawX | `src/types/providers.ts`（如存在）| 修改 |

### Provider 定义

```typescript
// 在 PROVIDER_TYPE_INFO 中新增
'clawx-cloud': {
  name: 'ClawX Cloud',
  icon: 'cloud',          // 使用云图标区分
  authType: 'none',       // 无需用户配置 API Key
  defaultBaseUrl: '',     // 由 authServerUrl 动态确定
  defaultModelId: 'gpt-4o',
  supportsCustomBaseUrl: false,
  description: '通过 ClawX 账户使用 AI 模型，无需配置 API Key',
}
```

### 验收标准

- [AC-2801] `clawx-cloud` 出现在 Provider 类型列表中
- [AC-2802] `clawx-cloud` 类型不显示 API Key 输入框
- [AC-2803] `clawx-cloud` 类型显示「通过 ClawX 账户认证」标识

---

## P2.S9 — 服务模式切换 UI

### 描述

在 Settings 或 Models 页面新增「服务模式」切换，让用户选择云端模式或本地模式。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/pages/Settings/index.tsx` | 修改 — 新增服务模式区块 |
| ClawX | `src/stores/settings.ts` | 修改 — 新增 `serviceMode` 配置 |
| ClawX | `electron/utils/store.ts` | 修改 — AppSettings 新增 `serviceMode` |
| ClawX | `src/components/settings/ServiceModeSettings.tsx` | 新增 |

### UI 规格

```
服务模式
─────────────────────
○ 云端模式（推荐）
  通过 ClawX 账户使用 AI 模型，无需配置 API Key。
  需要登录。
  
○ 本地模式
  使用自己的 API Key 直接连接大模型服务。
  需要手动配置 Provider。
```

### 行为规则

| 模式 | 行为 |
|------|------|
| 云端模式 | 自动创建 `clawx-cloud` Provider，隐藏其他 Provider 的 API Key 配置鼓励 |
| 本地模式 | 隐藏 `clawx-cloud`，显示全部本地 Provider 配置 |
| 未登录 + 云端 | 提示登录 |

### 验收标准

- [AC-2901] Settings 中显示服务模式切换
- [AC-2902] 切换生效后持久化到 `electron-store`
- [AC-2903] 云端模式下 Models 页面显示 `clawx-cloud` 为主要 Provider
- [AC-2904] 本地模式下不显示 `clawx-cloud` Provider

---

## P2.S10 — 登录后自动注入云端 Provider

### 描述

用户 SSO 登录成功后，自动在 Gateway 的 Provider 配置中注入 `clawx-cloud`，使 Gateway 请求通过 ClawX Backend 代理。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `electron/services/auth/auth-service.ts` | 修改 — 登录成功后注入 Provider |
| ClawX | `electron/services/providers/` | 修改 — 支持创建 `clawx-cloud` 类型 |
| ClawX | `electron/gateway/config-sync.ts` | 修改 — 写入 auth-profiles.json 时包含 cloud provider |

### 流程

```
SSO 登录成功
    │
    ▼
创建/更新 ProviderAccount {
    id: 'clawx-cloud-default',
    type: 'clawx-cloud',
    name: 'ClawX Cloud',
    baseUrl: '{backendUrl}/api/v1/llm',
    model: 'gpt-4o',
}
    │
    ▼
设置 API Key 为当前 JWT Access Token
    │
    ▼
设为默认 Provider（如果是云端模式）
    │
    ▼
触发 Gateway reload（SIGUSR1 或 restart）
使 auth-profiles.json 生效
```

### Token 刷新联动

JWT 刷新后需要同步更新 `clawx-cloud` Provider 的 API Key：

```
Token 刷新成功 → 更新 ProviderAccount 的 API Key → 触发 Gateway reload
```

### 验收标准

- [AC-21001] 登录后 `clawx-cloud` Provider 自动出现
- [AC-21002] 登出后 `clawx-cloud` Provider 自动移除
- [AC-21003] Gateway 通过 `clawx-cloud` Provider 发送的请求到达 Backend
- [AC-21004] Token 刷新后 Gateway 使用新 Token
- [AC-21005] 在云端模式下，Chat 页面可以正常使用 AI 对话（端到端验证）

---

## P2.S11 — Backend 部署与健康检查

### 描述

ClawX Backend 的部署配置和健康检查端点。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `cmd/server/main.go` | 修改 — 注册路由 |
| `Dockerfile` | 新增/修改 |
| `docker-compose.yaml` | 新增/修改 |

### 健康检查端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 存活检查 |
| GET | `/ready` | 就绪检查（SSO 可达 + Billing 可达） |

### 验收标准

- [AC-21101] Docker build + run 成功
- [AC-21102] `/health` 返回 200
- [AC-21103] `/ready` 在依赖服务可达时返回 200，不可达时返回 503

---

## 文件清单汇总

### ClawX Backend（新建项目）

| 文件 | Story |
|------|-------|
| `cmd/server/main.go` | P2.S1, P2.S11 |
| `internal/config/config.go` | P2.S1 |
| `internal/middleware/auth.go` | P2.S2 |
| `internal/model/user.go` | P2.S2 |
| `internal/model/usage.go` | P2.S6 |
| `internal/handler/llm_proxy.go` | P2.S4, P2.S5 |
| `internal/service/llm/provider_registry.go` | P2.S3 |
| `internal/service/llm/types.go` | P2.S3 |
| `internal/service/llm/proxy.go` | P2.S4 |
| `internal/service/llm/stream_proxy.go` | P2.S5 |
| `internal/service/llm/usage_collector.go` | P2.S6 |
| `internal/service/pricing/pricing.go` | P2.S7 |
| `internal/service/pricing/pricing_table.go` | P2.S7 |
| `configs/config.yaml` | P2.S1 |
| `configs/pricing.yaml` | P2.S7 |
| `Dockerfile` | P2.S11 |
| `docker-compose.yaml` | P2.S11 |

### ClawX 修改

| 文件 | Story |
|------|-------|
| `src/lib/providers.ts` | P2.S8 |
| `src/pages/Settings/index.tsx` | P2.S9 |
| `src/stores/settings.ts` | P2.S9 |
| `src/components/settings/ServiceModeSettings.tsx` | P2.S9（新增） |
| `electron/utils/store.ts` | P2.S9 |
| `electron/services/auth/auth-service.ts` | P2.S10 |
| `electron/services/providers/` | P2.S10 |
| `electron/gateway/config-sync.ts` | P2.S10 |
| `src/i18n/locales/en.json` | P2.S8, P2.S9 |
| `src/i18n/locales/zh-CN.json` | P2.S8, P2.S9 |

---

## 测试检查清单

### Backend 测试

- [ ] JWT 认证中间件：valid/invalid/expired token
- [ ] Provider 路由：已知/未知 provider、模型前缀推断
- [ ] 非 Streaming 代理：OpenAI + Anthropic
- [ ] Streaming 代理：OpenAI SSE + Anthropic SSE
- [ ] 长对话 streaming 稳定性（>2 分钟持续输出）
- [ ] 客户端断开后上游连接及时关闭
- [ ] Usage 采集准确性
- [ ] 上游 API 5xx 时的错误透传

### 前端测试

- [ ] 云端模式下 `clawx-cloud` Provider 正确显示
- [ ] 本地模式下 `clawx-cloud` 隐藏
- [ ] 登录后自动创建 Provider，Chat 可正常使用
- [ ] 登出后 Provider 自动移除
- [ ] 服务模式切换后持久化

### 端到端测试

- [ ] 登录 → 云端模式 → Chat 发送消息 → 收到 AI 回复（Streaming）
- [ ] 切换到本地模式 → 使用自有 API Key → Chat 正常
