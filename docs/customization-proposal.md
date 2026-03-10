
# ClawX 定制化改造技术方案

> 版本: v0.1 (Draft)
> 日期: 2026-03-10
> 状态: 待 Review

---

## 目录

- [1. 背景与目标](#1-背景与目标)
- [2. 现状分析](#2-现状分析)
- [3. 整体架构设计](#3-整体架构设计)
- [4. 需求一：SSO 登录与用户信息展示](#4-需求一sso-登录与用户信息展示)
- [5. 需求二：后端 LLM 代理服务](#5-需求二后端-llm-代理服务)
- [6. 需求三：Billing 计费与钱包系统](#6-需求三billing-计费与钱包系统)
- [7. 数据流总览](#7-数据流总览)
- [8. 改动影响范围](#8-改动影响范围)
- [9. 风险与待确认项](#9-风险与待确认项)
- [10. 里程碑与优先级建议](#10-里程碑与优先级建议)

---

## 1. 背景与目标

ClawX 当前是一个纯本地 Electron 桌面应用，用户需要自行配置各大模型 Provider 的 API Key，所有 LLM 请求直接从客户端发出。本次改造目标：

| # | 需求 | 核心价值 |
|---|------|---------|
| 1 | 接入 SSO 登录，展示用户信息 | 用户身份统一管理，为后续计费/权限打基础 |
| 2 | 后端代理所有大模型请求 | 用户无需关心 API Key，统一管控与审计 |
| 3 | 接入 Billing 支付系统 | Token 消耗计费、用户钱包、充值闭环 |

---

## 2. 现状分析

### 2.1 ClawX 架构概览

```
┌─────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand + Vite)       │
│  ┌──────────┐ ┌─────────┐ ┌──────────────┐  │
│  │ Chat     │ │ Models  │ │ Settings     │  │
│  │ Page     │ │ Page    │ │ Page         │  │
│  └────┬─────┘ └────┬────┘ └──────┬───────┘  │
│       │            │             │           │
│  ┌────┴────────────┴─────────────┴────┐      │
│  │  host-api.ts / api-client.ts       │      │
│  │  (IPC → Host API → Gateway)        │      │
│  └────────────────┬───────────────────┘      │
├───────────────────┼──────────────────────────┤
│  Main Process     │                          │
│  ┌────────────────┴──────────────┐           │
│  │  Host API Server (:3210)      │           │
│  │  Routes: providers, settings, │           │
│  │  usage, gateway, channels...  │           │
│  └────────────────┬──────────────┘           │
│  ┌────────────────┴──────────────┐           │
│  │  Gateway Manager              │           │
│  │  (OpenClaw Gateway :18789)    │           │
│  │  WS + HTTP + IPC              │           │
│  └───────────────────────────────┘           │
│  ┌───────────────────────────────┐           │
│  │  electron-store               │           │
│  │  - settings (theme, lang...)  │           │
│  │  - clawx-providers (API keys) │           │
│  └───────────────────────────────┘           │
└──────────────────────────────────────────────┘
```

### 2.2 关键现状

| 维度 | 当前状态 |
|------|---------|
| 认证/用户体系 | **无**。无登录、无用户概念，纯本地应用 |
| API Key 管理 | 用户手动输入，存储在 `electron-store` 的 `clawx-providers` 中，同步写入 `~/.openclaw/auth-profiles.json` 供 Gateway 使用 |
| LLM 请求路径 | 前端 → Main Process (IPC) → Gateway (本地进程) → 各 LLM Provider API |
| Token 用量统计 | 解析 `~/.openclaw/agents/*/sessions/*.jsonl` 中 assistant 消息的 `usage` 字段，纯本地统计 |
| 状态管理 | Zustand stores（`providers.ts`、`settings.ts`、`gateway.ts`、`chat.ts` 等） |
| Host API | Main Process 中的 HTTP Server（端口 3210），供 Renderer 通过 IPC 代理调用 |

### 2.3 sureup_laravel SSO 能力

| 能力 | 说明 |
|------|------|
| SSO 流程 | 标准 OAuth2 授权码流程 |
| 端点 | `GET /sso/login` → 登录页；`POST /api/v1/sso/token` → code 换 JWT |
| Token | JWT Access Token + Refresh Token，支持 space 上下文 |
| 用户信息 | `GET /api/v1/me` 返回用户基本信息 |
| Client 配置 | `config/sso.php` 中注册 client（`client_id`、`client_secret`、`redirect_uris`） |

### 2.4 arvio-billing 能力

| 能力 | 说明 |
|------|------|
| 计费单位 | 积分（Points），由业务侧 token → 积分换算后调用扣费 |
| 钱包 | `owner_id` + `owner_type`（user/team/school），余额 + 冻结余额 + 乐观锁 |
| 充值 | 通过 Product + Order，支持 Alipay（网页支付）和 Mock（测试） |
| 扣费/退费 | `POST /api/v1/points/deduct`、`POST /api/v1/points/refund`，幂等键保护 |
| 交易记录 | `GET /api/v1/points/transactions`，按月分表 |

---

## 3. 整体架构设计

改造后的架构增加一个**后端代理服务层**（ClawX Backend / Proxy），负责认证、LLM 代理、计费三大职责：

```
┌──────────────────────────────────────────────────────────┐
│                    ClawX Electron App                     │
│                                                          │
│  Renderer                                                │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌───────────┐  │
│  │ Chat │ │Models│ │Settings│ │ Wallet │ │ User Info │  │
│  └──┬───┘ └──┬───┘ └───┬────┘ └───┬────┘ └─────┬─────┘  │
│     │        │         │          │             │        │
│  ┌──┴────────┴─────────┴──────────┴─────────────┴──┐     │
│  │          统一 API 层 (host-api.ts 扩展)          │     │
│  │  - 本地调用 → Host API (IPC)                     │     │
│  │  - 远程调用 → ClawX Backend (HTTPS)              │     │
│  └──────────────────┬──────────────────────────────┘     │
│                     │                                    │
│  Main Process       │                                    │
│  ┌──────────────────┴─────────────────────┐              │
│  │ Host API Server (:3210) [扩展]          │              │
│  │ + Auth Store (JWT 持久化)               │              │
│  │ + Remote API Proxy (→ ClawX Backend)    │              │
│  └────────────────────────────────────────┘              │
│  ┌────────────────────────────────────────┐              │
│  │ Gateway Manager (保留，本地 Gateway)     │              │
│  └────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS
                          ▼
┌──────────────────────────────────────────────────────────┐
│              ClawX Backend (新增服务)                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Auth Module  │  │ LLM Proxy    │  │ Billing Module │  │
│  │ (SSO 验证)   │  │ (模型代理)    │  │ (钱包/扣费)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                 │                  │           │
│    ┌────┴─────┐     ┌─────┴──────┐     ┌─────┴──────┐   │
│    │sureup_   │     │ OpenAI /   │     │ arvio-     │   │
│    │laravel   │     │ Anthropic  │     │ billing    │   │
│    │SSO API   │     │ / Google   │     │ API        │   │
│    └──────────┘     │ / ARK /... │     └────────────┘   │
│                     └────────────┘                       │
└──────────────────────────────────────────────────────────┘
```

### 3.1 ClawX Backend 技术选型建议

| 维度 | 建议 | 理由 |
|------|------|------|
| 语言 | Go | 与 arvio-billing 同栈，高性能 HTTP 代理，团队经验 |
| 框架 | Gin | 与 billing 保持一致 |
| 部署 | 容器化（Docker） | 与现有基础设施对齐 |
| LLM 代理 | HTTP Reverse Proxy + Streaming | 支持 SSE/Streaming 转发 |

### 3.2 设计原则

1. **向后兼容**：保留本地 Gateway + 本地 Provider 能力，用户可选择本地模式（自有 API Key）或云端模式（通过后端代理）
2. **最小侵入**：不改动 OpenClaw Gateway 核心逻辑，通过 Host API 扩展 + 新增 Zustand Store 实现
3. **渐进迁移**：SSO → Proxy → Billing 可分阶段交付

---

## 4. 需求一：SSO 登录与用户信息展示

### 4.1 流程设计

```
┌───────────┐       ┌──────────┐       ┌──────────────┐
│ ClawX App │       │ 系统浏览器 │       │ sureup_laravel│
│ (Electron)│       │          │       │  SSO Server   │
└─────┬─────┘       └────┬─────┘       └──────┬───────┘
      │                  │                    │
      │ 1. 点击"登录"     │                    │
      │─────────────────>│                    │
      │ shell.openExternal                    │
      │  /sso/login?client_id=clawx           │
      │  &redirect_uri=clawx://auth/callback  │
      │  &state={random}  │                    │
      │                  │ 2. 用户在浏览器登录  │
      │                  │──────────────────-->│
      │                  │                    │
      │                  │ 3. 重定向            │
      │                  │<───────────────────│
      │                  │ clawx://auth/callback
      │                  │ ?code=xxx&state=yyy │
      │                  │                    │
      │ 4. Deep Link 回调 │                    │
      │<─────────────────│                    │
      │                  │                    │
      │ 5. 用 code 换 token                    │
      │──────────────────────────────────────>│
      │     POST /api/v1/sso/token            │
      │     {code, client_id, client_secret}  │
      │                                       │
      │ 6. 返回 JWT                            │
      │<──────────────────────────────────────│
      │  {access_token, refresh_token,        │
      │   expires_in}                         │
      │                                       │
      │ 7. 获取用户信息                         │
      │──────────────────────────────────────>│
      │     GET /api/v1/me                    │
      │     Authorization: Bearer <token>     │
      │                                       │
      │ 8. 返回用户信息                         │
      │<──────────────────────────────────────│
      │  {id, name, email, avatar_url, ...}   │
```

### 4.2 sureup_laravel 侧配置

在 `config/sso.php` 的 `clients` 数组中注册 ClawX 客户端：

```php
'clawx' => [
    'name' => 'ClawX Desktop',
    'secret' => env('SSO_CLIENT_CLAWX_SECRET'),
    'redirect_uris' => [
        'clawx://auth/callback',
    ],
],
```

### 4.3 Electron 侧改动

#### 4.3.1 Deep Link 注册

在 `electron/main/index.ts` 中注册自定义协议 `clawx://`：

```typescript
// 注册为默认协议处理器
if (process.defaultApp) {
  app.setAsDefaultProtocolClient('clawx', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('clawx');
}

// macOS: open-url 事件
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// Windows/Linux: second-instance 事件
app.on('second-instance', (_event, argv) => {
  const url = argv.find(arg => arg.startsWith('clawx://'));
  if (url) handleAuthCallback(url);
});
```

#### 4.3.2 Auth Token 存储

新增 `electron/services/auth/auth-store.ts`：

```typescript
interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (ms)
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  phone?: string;
}
```

使用 `electron-store` 新建存储实例 `clawx-auth`，持久化 token 和用户信息。敏感 token 可考虑使用 `safeStorage.encryptString()` 加密后存储。

#### 4.3.3 Host API 新增路由

在 `electron/api/routes/` 新增 `auth.ts`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/status` | 返回当前登录状态和用户信息 |
| POST | `/api/auth/login` | 发起 SSO 登录（打开系统浏览器） |
| POST | `/api/auth/callback` | 处理 code → token 兑换 |
| POST | `/api/auth/refresh` | 刷新 Access Token |
| POST | `/api/auth/logout` | 登出（清除本地 token） |

#### 4.3.4 IPC 通道注册

在 `electron/main/ipc-handlers.ts` 中的 `UNIFIED_CHANNELS` 新增：

```
'auth:status', 'auth:login', 'auth:logout', 'auth:refresh'
```

#### 4.3.5 Renderer 侧改动

**新增文件：**

| 文件 | 职责 |
|------|------|
| `src/stores/auth.ts` | Zustand Auth Store（登录状态、用户信息、token） |
| `src/components/auth/LoginButton.tsx` | 登录/登出按钮 |
| `src/components/auth/UserAvatar.tsx` | 用户头像与下拉菜单 |
| `src/components/auth/LoginRequired.tsx` | 未登录时的引导提示 |

**修改文件：**

| 文件 | 改动 |
|------|------|
| `src/components/layout/Sidebar.tsx` | 底部展示用户信息或登录入口 |
| `src/pages/Settings/index.tsx` | 新增「账户」设置区块 |
| `src/App.tsx` | 应用启动时检查登录状态，初始化 Auth Store |

**Auth Store 核心接口：**

```typescript
interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: UserProfile | null;
  
  // Actions
  checkAuth: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}
```

### 4.4 Token 自动刷新

在 `host-api.ts` 或 Main Process 中增加拦截逻辑：当请求 ClawX Backend 返回 401 时，自动调用 `POST /api/v1/refresh` 刷新 token 并重试。参考 sureup_laravel 的 refresh token rotation 机制。

---

## 5. 需求二：后端 LLM 代理服务

### 5.1 架构设计

```
ClawX App                       ClawX Backend
┌──────────┐                    ┌───────────────────────────┐
│ Gateway   │                   │                           │
│ (本地)    │─── LLM 请求 ──────>│  /api/v1/llm/proxy        │
│          │   (带 JWT auth)    │  ┌─────────────────────┐  │
│          │                    │  │ Auth Middleware      │  │
│          │                    │  │ (JWT 校验)           │  │
│          │                    │  └──────────┬──────────┘  │
│          │                    │  ┌──────────┴──────────┐  │
│          │                    │  │ Balance Check       │  │
│          │                    │  │ (余额预检)           │  │
│          │                    │  └──────────┬──────────┘  │
│          │                    │  ┌──────────┴──────────┐  │
│          │                    │  │ Proxy Router        │  │
│          │                    │  │ (按 provider 转发)   │  │
│          │                    │  └──────────┬──────────┘  │
│          │                    │             │             │
│          │                    │     ┌───────┼───────┐     │
│          │                    │     ▼       ▼       ▼     │
│          │                    │  OpenAI  Anthropic  ARK   │
│          │<── SSE Stream ─────│  (API Keys 服务端管理)     │
│          │                    │  ┌──────────┴──────────┐  │
│          │                    │  │ Usage Collector     │  │
│          │                    │  │ (解析 response 的    │  │
│          │                    │  │  usage → 扣费)       │  │
│          │                    │  └─────────────────────┘  │
└──────────┘                    └───────────────────────────┘
```

### 5.2 代理策略：两种模式共存

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **云端模式**（默认） | Gateway 的 Provider 配置为 ClawX Backend 的代理地址，无需 API Key | 普通用户 |
| **本地模式** | 用户自行配置 API Key，直接请求 LLM Provider | 高级用户/离线 |

实现方式：在 Provider 配置中增加一个特殊类型 `clawx-cloud`，其 `baseUrl` 指向 ClawX Backend。

### 5.3 ClawX Backend LLM Proxy 接口设计

#### 5.3.1 统一代理入口

```
POST /api/v1/llm/chat/completions
Authorization: Bearer <user_jwt>
X-Provider: openai | anthropic | google | ark | ...
X-Model: gpt-4o | claude-sonnet-4-20250514 | ...
Content-Type: application/json

{body 直接透传给上游 LLM API}
```

#### 5.3.2 处理流程

```
1. JWT 认证 → 解析 user_id
2. 查询用户钱包余额（arvio-billing GET /api/v1/wallets/:ownerId?ownerType=user）
3. 余额不足 → 返回 402 Payment Required
4. 根据 X-Provider + X-Model 选择上游 endpoint 和 API Key
5. 转发请求（支持 SSE Streaming 透传）
6. 解析 response 中的 usage 字段
   - input_tokens / output_tokens / cache_read_tokens 等
7. 按定价规则计算积分消耗
8. 调用 arvio-billing POST /api/v1/points/deduct 扣费
9. 记录 usage 日志（用于前端展示）
```

#### 5.3.3 Streaming SSE 代理要点

- 使用 `io.Copy` 或逐 chunk 转发，确保首 token 延迟最低
- 在 stream 结束的最后一个 chunk（通常包含 `usage` 信息）中提取 token 消耗
- 扣费异步化：不阻塞 response stream，在 stream 完成后异步扣费
- 扣费失败不影响当前请求，走异步重试或告警

#### 5.3.4 Provider 密钥管理

| 配置项 | 说明 |
|--------|------|
| 各 Provider API Key | 存储在 Backend 的配置/环境变量中（不下发给客户端） |
| 模型定价表 | 配置文件或数据库，`{provider, model, input_price_per_1k, output_price_per_1k}` |
| 积分换算率 | 例如 `1 积分 = ¥0.01`，用于 token cost → 积分计算 |

### 5.4 Gateway 对接方案

核心思路：将 ClawX Backend 注册为一个 OpenClaw 的自定义 Provider。

#### 方案 A：修改 auth-profiles.json（推荐）

Gateway 读取 `~/.openclaw/auth-profiles.json` 获取 Provider 配置。在云端模式下：

```json
{
  "profiles": {
    "clawx-cloud": {
      "provider": "openai",
      "baseUrl": "https://clawx-backend.example.com/api/v1/llm",
      "apiKey": "<user_jwt_token>"
    }
  }
}
```

将 JWT 作为 API Key 传给 Backend，Backend 从 `Authorization: Bearer` 中提取并验证。

#### 方案 B：Gateway 增加 Auth Header 注入

如果 Gateway 支持自定义 header，可以将 JWT 注入到请求中。此方案需要评估 Gateway 的可扩展性。

**推荐方案 A**，因为不需要修改 Gateway 代码，且 OpenAI-compatible API 的 `apiKey` 天然映射为 `Authorization: Bearer`。

### 5.5 前端改动

**新增/修改：**

| 文件 | 改动 |
|------|------|
| `src/lib/providers.ts` | 新增 `clawx-cloud` Provider 类型定义 |
| `src/components/settings/ProvidersSettings.tsx` | 云端模式下隐藏 API Key 输入，显示「已通过 ClawX 账户认证」 |
| `electron/services/providers/` | 登录后自动创建 `clawx-cloud` Provider，注入 JWT 作为 API Key |

**模式切换 UI：**

在 Models 页面或 Settings 页面新增「服务模式」切换：
- **云端模式**：默认，登录后自动可用，无需配置
- **本地模式**：手动配置 API Key，保留现有全部功能

---

## 6. 需求三：Billing 计费与钱包系统

### 6.1 计费流程

```
                                    ClawX Backend
用户发送消息 ──> Gateway ──> LLM Proxy ──────────────────> LLM Provider
                                  │                            │
                                  │ 5. stream 结束，解析 usage   │
                                  │<────────────────────────────│
                                  │                            
                                  │ 6. token → 积分换算
                                  │    input:  150k tokens × $3/1M = $0.45
                                  │    output: 800 tokens × $15/1M = $0.012
                                  │    total cost = $0.462 → 47 积分
                                  │
                                  │ 7. 调用 billing 扣费
                                  ▼
                           arvio-billing
                    POST /api/v1/points/deduct
                    {
                      ownerId: "user_xxx",
                      ownerType: "user",
                      amount: 47,
                      bizType: "llm_usage",
                      bizId: "req_xxx",
                      remark: "gpt-4o | in:150k out:800"
                    }
```

### 6.2 定价模型设计

建议在 ClawX Backend 维护一张模型定价表：

```go
type ModelPricing struct {
    Provider        string  // openai, anthropic, google, ark...
    Model           string  // gpt-4o, claude-sonnet-4-20250514...
    InputPer1M      float64 // 每 1M input tokens 的美元价格
    OutputPer1M     float64 // 每 1M output tokens 的美元价格
    CacheReadPer1M  float64 // 缓存读取
    CacheWritePer1M float64 // 缓存写入
    PointsPerCent   float64 // 1 美分 = N 积分（换算系数）
}
```

积分计算公式：

```
cost_usd = (input_tokens × input_per_1M + output_tokens × output_per_1M) / 1_000_000
points = ceil(cost_usd × 100 × points_per_cent)
```

### 6.3 钱包与充值前端

#### 6.3.1 新增页面/组件

| 文件 | 说明 |
|------|------|
| `src/pages/Wallet/index.tsx` | 钱包主页面 |
| `src/pages/Wallet/Balance.tsx` | 余额展示卡片 |
| `src/pages/Wallet/TransactionHistory.tsx` | 交易记录列表 |
| `src/pages/Wallet/RechargeModal.tsx` | 充值弹窗（产品选择 + 支付） |
| `src/stores/wallet.ts` | Zustand Wallet Store |

#### 6.3.2 Wallet Store 接口

```typescript
interface WalletState {
  balance: number;
  frozenBalance: number;
  loading: boolean;
  
  // 产品
  products: Product[];
  
  // 交易记录
  transactions: Transaction[];
  transactionsLoading: boolean;
  
  // Actions
  fetchBalance: () => Promise<void>;
  fetchProducts: () => Promise<void>;
  fetchTransactions: (params: { startTime: string; endTime: string }) => Promise<void>;
  createOrder: (productId: string) => Promise<OrderResponse>;
  syncOrderStatus: (orderId: string) => Promise<void>;
}
```

#### 6.3.3 充值流程

```
1. 用户点击「充值」
2. 展示产品列表（从 arvio-billing 的 GET /api/v1/products 获取）
3. 用户选择套餐，点击「支付」
4. 前端调用 ClawX Backend → Backend 调用 billing POST /api/v1/orders
5. 返回 paymentForm（Alipay HTML）
6. 在 Electron 中打开新窗口或系统浏览器渲染支付页面
7. 用户完成支付
8. 前端轮询/回调确认支付状态（POST /api/v1/orders/:id/sync）
9. 支付成功 → 刷新余额
```

#### 6.3.4 余额展示位置

- **Sidebar 底部**：在用户信息旁显示余额小标签
- **Chat 页面顶部**：可选，显示当前会话累计消耗
- **Wallet 页面**：详细余额、交易记录、充值入口

#### 6.3.5 余额不足处理

当 LLM Proxy 返回 402 时：

1. Gateway 收到 402 响应
2. 前端展示「余额不足」提示弹窗
3. 弹窗包含「去充值」按钮，一键跳转到充值页面

### 6.4 ClawX Backend Billing 相关接口

Backend 作为 BFF（Backend For Frontend），封装对 arvio-billing 的调用：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/wallet` | 查询当前用户钱包余额 |
| GET | `/api/v1/wallet/transactions` | 查询交易记录 |
| GET | `/api/v1/products` | 获取充值产品列表 |
| POST | `/api/v1/orders` | 创建充值订单 |
| GET | `/api/v1/orders/:id` | 查询订单详情 |
| POST | `/api/v1/orders/:id/sync` | 同步订单支付状态 |
| GET | `/api/v1/usage/summary` | 获取 token 用量汇总（后端统计） |

所有接口都需要 JWT 认证，Backend 从 JWT 解析 `user_id` 后作为 `ownerId` 传给 billing。

---

## 7. 数据流总览

### 7.1 认证数据流

```
ClawX App ──(SSO Login)──> sureup_laravel
    │                          │
    │<──(JWT + Refresh Token)──│
    │                          
    │──(JWT)──> ClawX Backend ──(checkjwt)──> sureup_laravel
    │                │
    │<──(user info)──│
```

### 7.2 LLM 请求数据流

```
User ──> Chat UI ──> Gateway ──(SSE request + JWT)──> ClawX Backend
                                    │
                                    │──(LLM request + Server API Key)──> LLM Provider
                                    │<──(SSE stream + usage)──────────│
                                    │
                                    │──(deduct points)──> arvio-billing
                                    │
                        <──(SSE stream)──│
```

### 7.3 充值数据流

```
User ──> Wallet UI ──> ClawX Backend ──> arvio-billing
                            │                  │
                            │<──(order + form)─│
                            │
              ──(open browser for payment)──> Alipay
                            │
              <──(payment complete)──
                            │
              ──(sync order)──> ClawX Backend ──> arvio-billing
                            │<──(credited)──────│
```

---

## 8. 改动影响范围

### 8.1 新增文件（ClawX）

| 位置 | 文件 | 说明 |
|------|------|------|
| `electron/services/auth/` | `auth-store.ts` | Auth token 存储与管理 |
| `electron/services/auth/` | `auth-service.ts` | SSO 登录/登出/刷新逻辑 |
| `electron/api/routes/` | `auth.ts` | Auth 相关 Host API 路由 |
| `electron/api/routes/` | `wallet.ts` | Wallet 代理路由（→ Backend） |
| `src/stores/` | `auth.ts` | Zustand Auth Store |
| `src/stores/` | `wallet.ts` | Zustand Wallet Store |
| `src/pages/Wallet/` | `index.tsx` 等 | 钱包页面 |
| `src/components/auth/` | `LoginButton.tsx` 等 | 认证 UI 组件 |
| `src/components/wallet/` | `BalanceTag.tsx` 等 | 余额展示组件 |

### 8.2 修改文件（ClawX）

| 文件 | 改动说明 |
|------|---------|
| `electron/main/index.ts` | 注册 `clawx://` 协议、Deep Link 处理 |
| `electron/main/ipc-handlers.ts` | 注册 auth/wallet IPC 通道 |
| `electron/api/server.ts` | 挂载 auth、wallet 路由 |
| `electron/utils/store.ts` | AppSettings 增加 `authServerUrl`、`serviceMode` |
| `src/App.tsx` | 启动时检查 auth、路由增加 Wallet 页面 |
| `src/components/layout/Sidebar.tsx` | 用户信息/余额展示 |
| `src/components/layout/MainLayout.tsx` | 未登录提示 |
| `src/lib/providers.ts` | 新增 `clawx-cloud` Provider 类型 |
| `src/lib/host-api.ts` | 请求拦截增加 JWT header |
| `src/pages/Settings/index.tsx` | 新增账户区块、服务模式切换 |
| `src/pages/Models/index.tsx` | 云端模式 UI 适配 |
| `src/i18n/` | 新增翻译 key |

### 8.3 新增服务（ClawX Backend）

| 模块 | 说明 |
|------|------|
| `cmd/server/main.go` | 服务入口 |
| `internal/config/` | 配置（SSO、LLM Providers、Billing 地址等） |
| `internal/middleware/auth.go` | JWT 认证中间件（调用 sureup_laravel `/api/v1/internal/checkjwt`） |
| `internal/handler/auth.go` | Auth BFF（SSO token exchange） |
| `internal/handler/llm_proxy.go` | LLM 代理 handler（Streaming SSE） |
| `internal/handler/wallet.go` | Wallet BFF（转发 billing API） |
| `internal/handler/products.go` | Products BFF |
| `internal/handler/orders.go` | Orders BFF |
| `internal/service/llm/` | LLM 路由、Provider 密钥管理 |
| `internal/service/billing/` | Billing 调用封装 |
| `internal/service/pricing/` | Token → 积分定价计算 |
| `internal/model/` | 数据结构定义 |

### 8.4 sureup_laravel 改动

| 改动 | 说明 |
|------|------|
| `config/sso.php` | 注册 `clawx` SSO Client |
| `.env` | 新增 `SSO_CLIENT_CLAWX_SECRET` |

### 8.5 arvio-billing 改动

**无需修改**。现有 API 已满足所有需求：
- 钱包创建/查询
- 积分扣费/退费
- 产品/订单
- 交易记录

仅需确保为 ClawX 用户创建钱包（可在 SSO 首次登录时通过 Backend 调用 `POST /api/v1/wallets` 自动创建）。

---

## 9. 风险与待确认项

### 9.1 待确认

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | sureup_laravel 是否支持 `clawx://` 作为 redirect_uri | SSO 登录流程 | 需确认 `SsoService::validateRedirectUri()` 逻辑 |
| 2 | Gateway 作为代理时，是否能正确透传 `Authorization` header 到上游 | LLM 代理 | 需测试 OpenClaw Gateway 对 custom baseUrl + apiKey 的行为 |
| 3 | arvio-billing 是否需要开放外网访问或仅内网 | 安全架构 | 建议仅内网，ClawX Backend 作为唯一调用方 |
| 4 | 支付宝支付在 Electron 中的体验（新窗口/系统浏览器） | 充值 UX | 建议使用系统默认浏览器打开支付页面 |
| 5 | ClawX Backend 部署域名和 HTTPS 证书 | 全流程 | 需提前规划 |
| 6 | 用户首次登录时钱包自动创建的时机和保障 | Billing | 建议在 SSO token exchange 成功后同步创建 |
| 7 | Gateway 对 402 状态码的处理 | 余额不足 UX | 需确认 Gateway 如何处理非标准 HTTP 错误 |
| 8 | 离线/网络不可用时的降级策略 | 体验 | 本地模式可作为 fallback |

### 9.2 技术风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| SSE Streaming 代理的稳定性 | 中 | 充分测试长连接场景，增加超时和重试机制 |
| 扣费与实际消耗的一致性 | 中 | Streaming 结束后异步扣费 + 对账机制 |
| JWT 过期导致请求中断 | 低 | 前端定时刷新 token，Main Process 拦截 401 自动刷新 |
| 多端同时登录冲突 | 低 | Refresh token rotation 确保最新设备优先 |

---

## 10. 里程碑与优先级建议

### Phase 1：SSO 登录（基础设施）

**预估周期：1~1.5 周**

- [ ] sureup_laravel 注册 ClawX SSO Client
- [ ] Electron Deep Link 注册与回调处理
- [ ] Auth Store + Auth Service（Main Process）
- [ ] Host API auth 路由
- [ ] Renderer Auth Store + 登录 UI
- [ ] Sidebar 用户信息展示
- [ ] Settings 账户区块

### Phase 2：LLM 代理服务

**预估周期：2~2.5 周**

- [ ] ClawX Backend 项目初始化（Go + Gin）
- [ ] JWT 认证中间件（对接 sureup_laravel checkjwt）
- [ ] LLM Proxy handler（SSE Streaming 转发）
- [ ] Provider 密钥管理与路由
- [ ] 模型定价表
- [ ] 前端 `clawx-cloud` Provider 类型
- [ ] 服务模式切换 UI
- [ ] 登录后自动注入云端 Provider

### Phase 3：Billing 与钱包

**预估周期：1.5~2 周**

- [ ] Backend Billing 集成（扣费、查询余额、交易记录）
- [ ] Backend 订单/产品 BFF 接口
- [ ] Token → 积分计算逻辑
- [ ] 异步扣费流水线
- [ ] Wallet 页面（余额、交易记录、充值）
- [ ] 充值流程（产品选择 → Alipay 支付 → 状态同步）
- [ ] Sidebar 余额标签
- [ ] 402 余额不足弹窗

### Phase 4：打磨与上线

**预估周期：1 周**

- [ ] 本地模式 / 云端模式双模测试
- [ ] 离线降级策略
- [ ] 国际化翻译完善
- [ ] 错误处理与边界情况
- [ ] 对账机制
- [ ] 部署与监控

---

## 附录

### A. 技术栈汇总

| 组件 | 技术 |
|------|------|
| ClawX Desktop | Electron + React 19 + TypeScript + Zustand + Vite |
| ClawX Backend | Go + Gin（新增） |
| SSO Server | sureup_laravel (PHP/Laravel)（已有） |
| Billing Service | arvio-billing (Go/Gin/PostgreSQL)（已有） |
| 支付 | Alipay 网页支付（已有） |

### B. 相关仓库

| 仓库 | 路径 | 关联 |
|------|------|------|
| ClawX | `/Users/umb/Desktop/project/ClawX/` | 主要改造目标 |
| sureup_laravel | `/Users/umb/Desktop/project/sureup_laravel/` | SSO 认证服务 |
| arvio-billing | `/Users/umb/Desktop/project/arvio/arvio-billing/` | 计费服务 |

### C. 关键 API 端点参考

**sureup_laravel（SSO）：**
- `GET /sso/login?client_id=&redirect_uri=&state=` — SSO 登录页
- `POST /api/v1/sso/token` — 授权码换 JWT
- `GET /api/v1/me` — 当前用户信息
- `POST /api/v1/refresh` — 刷新 Access Token
- `POST /api/v1/internal/checkjwt` — 内部 JWT 校验

**arvio-billing：**
- `POST /api/v1/wallets` — 创建钱包
- `GET /api/v1/wallets/:ownerId?ownerType=user` — 查询钱包
- `POST /api/v1/points/deduct` — 积分扣费
- `GET /api/v1/points/transactions` — 交易记录
- `GET /api/v1/products` — 产品列表
- `POST /api/v1/orders` — 创建充值订单
- `POST /api/v1/orders/:orderId/sync` — 同步订单状态
