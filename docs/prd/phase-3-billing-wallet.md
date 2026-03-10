# Phase 3：Billing 计费与钱包系统

> 预估周期：1.5~2 周
> 前置依赖：Phase 2（LLM 代理服务）完成
> 涉及仓库：ClawX、ClawX Backend

---

## 目标

在 LLM 代理基础上接入 arvio-billing 计费系统，实现按 token 消耗扣费。前端新增钱包页面，展示余额、交易记录，支持充值。

---

## Story 列表

| ID | Story | 优先级 | 预估 |
|----|-------|--------|------|
| P3.S1 | Backend Billing Client 封装 | P0 | 1d |
| P3.S2 | 用户首次登录自动创建钱包 | P0 | 0.5d |
| P3.S3 | LLM Proxy 接入扣费流程 | P0 | 1.5d |
| P3.S4 | 余额预检与 402 处理 | P0 | 0.5d |
| P3.S5 | Backend 钱包/交易 BFF 接口 | P0 | 1d |
| P3.S6 | Backend 产品/订单 BFF 接口 | P0 | 1d |
| P3.S7 | 前端 Wallet Store | P0 | 0.5d |
| P3.S8 | 前端钱包页面 — 余额与交易记录 | P0 | 1.5d |
| P3.S9 | 前端充值流程 | P0 | 1.5d |
| P3.S10 | Sidebar 余额标签 | P1 | 0.5d |
| P3.S11 | 402 余额不足弹窗 | P0 | 0.5d |

---

## P3.S1 — Backend Billing Client 封装

### 描述

在 ClawX Backend 中封装对 arvio-billing 的 HTTP 调用。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/service/billing/client.go` | 新增 |
| `internal/service/billing/types.go` | 新增 |

### Client 方法

```go
type BillingClient struct {
    baseURL    string
    httpClient *http.Client
}

func (c *BillingClient) CreateWallet(ownerID, ownerType string) (*Wallet, error)
func (c *BillingClient) GetWallet(ownerID, ownerType string) (*Wallet, error)
func (c *BillingClient) DeductPoints(req *DeductRequest) (*Transaction, error)
func (c *BillingClient) RefundPoints(req *RefundRequest) (*Transaction, error)
func (c *BillingClient) ListTransactions(ownerID, ownerType, startTime, endTime string) ([]Transaction, error)
func (c *BillingClient) ListProducts() ([]Product, error)
func (c *BillingClient) GetProduct(productID string) (*Product, error)
func (c *BillingClient) CreateOrder(req *CreateOrderRequest) (*Order, error)
func (c *BillingClient) GetOrder(orderID string) (*Order, error)
func (c *BillingClient) SyncOrder(orderID string) (*Order, error)
```

### 调用约定

- 所有请求附加 `X-Trace-Id` header（从 gin.Context 传递）
- 扣费/退费请求附加 `X-Idempotent-Key` header
- 超时：默认 10s，扣费 5s
- 错误处理：billing 返回非 2xx 时包装为业务错误

### 验收标准

- [AC-3101] 所有 billing API 方法可正确调用
- [AC-3102] 网络超时时返回清晰错误
- [AC-3103] 幂等键正确附加

---

## P3.S2 — 用户首次登录自动创建钱包

### 描述

用户通过 SSO 首次登录时，Backend 自动为其创建 billing 钱包。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/handler/auth.go`（Backend） | 修改 — 登录/token 校验成功后检查钱包 |
| `internal/service/billing/client.go` | 复用 |

### 流程

```
JWT 校验成功 → 尝试 GET /api/v1/wallets/{userId}?ownerType=user
    │
    ├── 200 OK → 钱包已存在，继续
    │
    └── 404 → POST /api/v1/wallets { ownerId, ownerType: "user" }
              → 创建成功 → 继续
              → 创建失败（409 已存在）→ 忽略，继续
```

### 触发时机

在 JWT 认证中间件中，验证通过后异步检查/创建钱包（不阻塞请求）。
用标记位或缓存避免每次请求都检查。

### 验收标准

- [AC-3201] 新用户首次请求后 billing 中存在对应钱包
- [AC-3202] 已有钱包的用户不会触发重复创建
- [AC-3203] 钱包创建失败不影响正常请求

---

## P3.S3 — LLM Proxy 接入扣费流程

### 描述

在 Phase 2 的 Usage 采集基础上，接入 arvio-billing 的扣费接口。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/service/llm/usage_collector.go` | 修改 — 增加扣费调用 |
| `internal/service/pricing/pricing.go` | 复用 |
| `internal/service/billing/client.go` | 复用 |

### 扣费流程

```
LLM 请求完成 → 采集 usage
    │
    ▼
PricingService.Calculate(provider, model, usage) → points
    │
    ▼
BillingClient.DeductPoints({
    ownerId:       userId,
    ownerType:     "user",
    amount:        points,
    bizType:       "llm_usage",
    bizId:         requestId,
    idempotentKey: "llm_{requestId}",
    remark:        "{model} | in:{inputTokens} out:{outputTokens}",
})
    │
    ├── 成功 → 记录日志
    │
    └── 失败 → 记录错误日志 + 告警
              （不影响已完成的 LLM 请求）
```

### 异步扣费

- Streaming 请求：stream 结束后在 goroutine 中异步扣费
- 非 Streaming 请求：response 返回后异步扣费
- 扣费失败重试：最多 3 次，间隔 1s/2s/4s

### 验收标准

- [AC-3301] 每次 LLM 请求完成后扣费成功
- [AC-3302] 扣费金额 = PricingService 计算结果
- [AC-3303] 幂等键确保同一请求不会重复扣费
- [AC-3304] 扣费失败时 LLM 请求已正常返回（不回滚 response）
- [AC-3305] 扣费失败有重试 + 告警日志
- [AC-3306] remark 中包含模型名和 token 数

---

## P3.S4 — 余额预检与 402 处理

### 描述

LLM 请求前检查用户余额，余额不足时拒绝请求。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/handler/llm_proxy.go` | 修改 — 增加余额检查 |
| `internal/middleware/balance_check.go` | 新增（可选，也可内联在 handler） |

### 流程

```
LLM 请求到达 → JWT 校验 → 查询余额
    │
    ├── 余额 > 0 → 继续处理
    │
    └── 余额 ≤ 0 → 返回 402 Payment Required
                   {
                     "error": "insufficient_balance",
                     "message": "余额不足，请充值后重试",
                     "balance": 0,
                     "code": 40200
                   }
```

### 余额缓存

- 查询余额有一定开销，使用短期缓存（如 10s）
- 缓存 key: `balance:{userId}`
- 扣费成功后主动失效缓存

### 验收标准

- [AC-3401] 余额 > 0 时请求正常通过
- [AC-3402] 余额 = 0 时返回 402 + 清晰错误消息
- [AC-3403] 余额缓存在扣费后及时失效

---

## P3.S5 — Backend 钱包/交易 BFF 接口

### 描述

Backend 提供前端所需的钱包和交易记录查询接口。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/handler/wallet.go` | 新增 |

### 接口定义

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/wallet` | 查询当前用户余额 |
| GET | `/api/v1/wallet/transactions` | 查询交易记录 |

#### GET /api/v1/wallet

```json
// Response
{
  "balance": 1000,
  "frozenBalance": 0,
  "availableBalance": 1000
}
```

#### GET /api/v1/wallet/transactions

```
Query: ?startTime=2026-03-01T00:00:00Z&endTime=2026-03-10T23:59:59Z&page=1&pageSize=20
```

```json
// Response
{
  "items": [
    {
      "id": "tx_xxx",
      "type": "deduct",
      "amount": 47,
      "direction": "out",
      "balanceAfter": 953,
      "bizType": "llm_usage",
      "remark": "gpt-4o | in:150k out:800",
      "createdAt": "2026-03-10T10:30:00Z"
    }
  ],
  "total": 42
}
```

### 验收标准

- [AC-3501] `/api/v1/wallet` 返回正确余额
- [AC-3502] `/api/v1/wallet/transactions` 支持时间范围和分页
- [AC-3503] 未登录时返回 401

---

## P3.S6 — Backend 产品/订单 BFF 接口

### 描述

Backend 提供充值产品查询和订单管理接口。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/handler/products.go` | 新增 |
| `internal/handler/orders.go` | 新增 |

### 接口定义

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/products` | 产品列表 |
| POST | `/api/v1/orders` | 创建充值订单 |
| GET | `/api/v1/orders/:id` | 查询订单详情 |
| POST | `/api/v1/orders/:id/sync` | 同步订单支付状态 |

#### POST /api/v1/orders

```json
// Request
{ "productId": "prod_basic" }

// Response
{
  "orderId": "ord_xxx",
  "status": "pending",
  "productName": "基础包",
  "priceCent": 2990,
  "paymentForm": "<html>...</html>"   // Alipay 支付表单
}
```

### 验收标准

- [AC-3601] `/api/v1/products` 返回所有产品
- [AC-3602] `/api/v1/orders` 创建订单返回 paymentForm
- [AC-3603] `/api/v1/orders/:id/sync` 正确同步支付状态
- [AC-3604] 订单创建使用当前用户 ID 作为 ownerId

---

## P3.S7 — 前端 Wallet Store

### 描述

Renderer 侧创建 Zustand Wallet Store，管理钱包状态。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/stores/wallet.ts` | 新增 |
| ClawX | `src/types/wallet.ts` | 新增 |

### 类型定义 (`types/wallet.ts`)

```typescript
export interface WalletInfo {
  balance: number;
  frozenBalance: number;
  availableBalance: number;
}

export interface Transaction {
  id: string;
  type: 'recharge' | 'deduct' | 'refund' | 'transfer';
  amount: number;
  direction: 'in' | 'out';
  balanceAfter: number;
  bizType: string;
  remark: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  priceCent: number;
  points: number;
  bonusPoints: number;
  type: 'topup' | 'monthly';
}

export interface Order {
  orderId: string;
  status: 'pending' | 'paid' | 'credited' | 'failed' | 'expired';
  productName: string;
  priceCent: number;
  paymentForm?: string;
}
```

### Store 接口

```typescript
interface WalletState {
  wallet: WalletInfo | null;
  walletLoading: boolean;
  products: Product[];
  productsLoading: boolean;
  transactions: Transaction[];
  transactionsLoading: boolean;
  transactionsTotal: number;

  fetchWallet: () => Promise<void>;
  fetchProducts: () => Promise<void>;
  fetchTransactions: (params: {
    startTime: string;
    endTime: string;
    page?: number;
    pageSize?: number;
  }) => Promise<void>;
  createOrder: (productId: string) => Promise<Order>;
  syncOrderStatus: (orderId: string) => Promise<Order>;
}
```

### 数据获取

所有请求通过 `hostApiFetch()` → Main Process → ClawX Backend。
需要在 Host API 新增转发路由（或复用 Phase 2 的 Remote API Proxy 机制）。

### 验收标准

- [AC-3701] `fetchWallet()` 正确获取并缓存余额
- [AC-3702] `fetchTransactions()` 支持分页
- [AC-3703] `createOrder()` 返回订单信息和支付表单

---

## P3.S8 — 前端钱包页面

### 描述

新增 Wallet 页面，展示余额和交易记录。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/pages/Wallet/index.tsx` | 新增 |
| ClawX | `src/pages/Wallet/BalanceCard.tsx` | 新增 |
| ClawX | `src/pages/Wallet/TransactionList.tsx` | 新增 |
| ClawX | `src/App.tsx` | 修改 — 新增 /wallet 路由 |
| ClawX | `src/components/layout/Sidebar.tsx` | 修改 — 新增 Wallet 导航入口 |
| ClawX | `src/i18n/locales/*.json` | 修改 |

### 页面结构

```
┌─────────────────────────────────────────────────┐
│  钱包                                            │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  可用余额                                   │  │
│  │  1,000 积分                    [充值] 按钮  │  │
│  │  ≈ ¥10.00                                 │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  交易记录                                        │
│  ┌───────────────────────────────────────────┐  │
│  │  日期筛选: [本月 ▾]                         │  │
│  │                                           │  │
│  │  03-10 10:30  扣费  -47 积分   余额 953     │  │
│  │               gpt-4o | in:150k out:800    │  │
│  │                                           │  │
│  │  03-10 09:00  充值  +300 积分  余额 1000    │  │
│  │               基础包                       │  │
│  │                                           │  │
│  │  ← 1 2 3 →                                │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 未登录态

使用 `LoginRequired` 组件引导登录。

### 验收标准

- [AC-3801] /wallet 路由正常加载
- [AC-3802] 余额卡片显示正确余额
- [AC-3803] 交易记录列表支持分页
- [AC-3804] 交易记录区分类型（充值/扣费）使用不同颜色
- [AC-3805] 日期筛选功能正常
- [AC-3806] 未登录时显示登录引导

---

## P3.S9 — 前端充值流程

### 描述

在钱包页面实现完整的充值流程：选择产品 → 创建订单 → 支付 → 确认。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/pages/Wallet/RechargeModal.tsx` | 新增 |
| ClawX | `src/pages/Wallet/ProductCard.tsx` | 新增 |
| ClawX | `src/pages/Wallet/PaymentPending.tsx` | 新增 |

### 充值弹窗 UI

```
┌─────────────────────────────────────────────────┐
│  选择充值套餐                              [×]   │
│                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 体验包    │ │ 基础包 ✓ │ │ 标准包    │        │
│  │ 100 积分  │ │ 310 积分  │ │ 520 积分  │        │
│  │ ¥9.90    │ │ ¥29.90   │ │ ¥49.90   │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ 进阶包    │ │ 超值包    │ │ 机构包    │        │
│  │ 1080 积分 │ │ 1950 积分 │ │ 8500 积分 │        │
│  │ ¥99.00   │ │ ¥169.00  │ │ ¥699.00  │        │
│  └──────────┘ └──────────┘ └──────────┘        │
│                                                 │
│  已选：基础包 310 积分 (含赠送 10)               │
│  应付：¥29.90                                    │
│                                                 │
│           [取消]     [去支付]                     │
└─────────────────────────────────────────────────┘
```

### 支付流程

```
1. 用户选择产品 → 点击「去支付」
2. 调用 createOrder(productId) → 获取 paymentForm
3. 使用 shell.openExternal() 或 BrowserWindow 打开支付页面
4. 显示「等待支付完成」状态
5. 轮询 syncOrderStatus(orderId)（每 3s 一次，最多 5 分钟）
6. 状态变为 credited → 提示成功 → 刷新余额
7. 超时/失败 → 提示「请确认支付是否完成」+ 手动同步按钮
```

### Alipay 支付页面

由于 `paymentForm` 是 HTML 表单，需要在真实浏览器中渲染并自动提交。

推荐方案：使用 `shell.openExternal()` 打开系统浏览器。
备选方案：在 Electron 中 `new BrowserWindow({ webPreferences: { nodeIntegration: false } })` 加载。

### 验收标准

- [AC-3901] 充值弹窗正确展示所有产品及价格
- [AC-3902] 积分数包含赠送积分（如 300 + 10 赠送 = 310）
- [AC-3903] 点击「去支付」后系统浏览器打开支付宝页面
- [AC-3904] 支付完成后余额自动刷新
- [AC-3905] 支付超时后提供手动同步按钮
- [AC-3906] 取消充值不会创建订单

---

## P3.S10 — Sidebar 余额标签

### 描述

在 Sidebar 用户信息区域旁边展示余额快览。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/components/wallet/BalanceTag.tsx` | 新增 |
| ClawX | `src/components/layout/Sidebar.tsx` | 修改 — 嵌入 BalanceTag |

### UI 规格

已登录态 Sidebar 底部：

```
┌─────────────────────────┐
│  [头像] 张三             │
│  💰 1,000 积分           │  ← BalanceTag，点击跳转 /wallet
└─────────────────────────┘
```

### 行为

- 仅云端模式 + 已登录时显示
- 余额 ≤ 100 时显示为警告色（橙色）
- 余额 = 0 时显示为错误色（红色）
- 点击跳转到 /wallet 页面

### 验收标准

- [AC-31001] 已登录 + 云端模式下 Sidebar 显示余额
- [AC-31002] 本地模式或未登录时不显示
- [AC-31003] 余额低时颜色变化
- [AC-31004] 点击跳转到钱包页面

---

## P3.S11 — 402 余额不足弹窗

### 描述

当 LLM 请求因余额不足被拒绝时，前端展示友好提示。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/components/wallet/InsufficientBalanceModal.tsx` | 新增 |
| ClawX | `src/pages/Chat/` | 修改 — 捕获 402 错误并展示弹窗 |
| ClawX | `src/stores/wallet.ts` | 修改 — 新增 showInsufficientBalance 状态 |

### UI 规格

```
┌─────────────────────────────────────────┐
│  ⚠️ 余额不足                             │
│                                         │
│  当前余额不足以完成此次请求。              │
│  请充值后重试。                           │
│                                         │
│  当前余额：0 积分                         │
│                                         │
│        [取消]        [去充值]             │
└─────────────────────────────────────────┘
```

### 触发条件

在 Chat 组件的消息发送错误处理中，检测到 response status 402 或 error code `insufficient_balance` 时弹出。

### 验收标准

- [AC-31101] 余额不足时弹窗正确展示
- [AC-31102] 点击「去充值」跳转到钱包页面或直接打开充值弹窗
- [AC-31103] 点击「取消」关闭弹窗
- [AC-31104] 弹窗显示当前余额

---

## 文件清单汇总

### ClawX Backend 新增

| 文件 | Story |
|------|-------|
| `internal/service/billing/client.go` | P3.S1 |
| `internal/service/billing/types.go` | P3.S1 |
| `internal/handler/wallet.go` | P3.S5 |
| `internal/handler/products.go` | P3.S6 |
| `internal/handler/orders.go` | P3.S6 |
| `internal/middleware/balance_check.go` | P3.S4 |

### ClawX Backend 修改

| 文件 | Story |
|------|-------|
| `internal/handler/llm_proxy.go` | P3.S4 |
| `internal/service/llm/usage_collector.go` | P3.S3 |
| `internal/handler/auth.go` | P3.S2 |
| `cmd/server/main.go` | P3.S5, P3.S6 |

### ClawX 新增

| 文件 | Story |
|------|-------|
| `src/types/wallet.ts` | P3.S7 |
| `src/stores/wallet.ts` | P3.S7 |
| `src/pages/Wallet/index.tsx` | P3.S8 |
| `src/pages/Wallet/BalanceCard.tsx` | P3.S8 |
| `src/pages/Wallet/TransactionList.tsx` | P3.S8 |
| `src/pages/Wallet/RechargeModal.tsx` | P3.S9 |
| `src/pages/Wallet/ProductCard.tsx` | P3.S9 |
| `src/pages/Wallet/PaymentPending.tsx` | P3.S9 |
| `src/components/wallet/BalanceTag.tsx` | P3.S10 |
| `src/components/wallet/InsufficientBalanceModal.tsx` | P3.S11 |

### ClawX 修改

| 文件 | Story |
|------|-------|
| `src/App.tsx` | P3.S8 |
| `src/components/layout/Sidebar.tsx` | P3.S8, P3.S10 |
| `src/pages/Chat/` | P3.S11 |
| `src/i18n/locales/*.json` | P3.S8, P3.S9, P3.S10, P3.S11 |
| `electron/api/routes/wallet.ts` | P3.S7（新增 — Host API 转发） |
| `electron/api/server.ts` | P3.S7 |

---

## 测试检查清单

### Backend 测试

- [ ] Billing Client 各方法的 happy path + 错误处理
- [ ] 首次登录自动创建钱包
- [ ] LLM 请求后正确扣费
- [ ] 幂等扣费（同一 requestId 不重复扣）
- [ ] 余额不足返回 402
- [ ] 余额缓存失效机制
- [ ] 订单创建和状态同步

### 前端测试

- [ ] 钱包页面加载并展示余额
- [ ] 交易记录分页
- [ ] 充值流程：选产品 → 创建订单 → 支付 → 余额更新
- [ ] Sidebar 余额标签正确显示
- [ ] 402 弹窗正确触发
- [ ] 未登录态的降级处理

### 端到端测试

- [ ] 登录 → Chat 发消息 → 余额减少 → 交易记录新增
- [ ] 充值 → 余额增加 → 继续 Chat
- [ ] 余额耗尽 → 发送消息 → 余额不足弹窗 → 充值 → 继续
