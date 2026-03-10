# 并发开发指南 — Phase 级 Agent 分工

> 策略：一个 Agent 负责一个 Phase，并发完成后用新 Agent 验证集成。

---

## 分工方案

```
             并发开发                         集成验证
┌─────────────────────────────────┐    ┌─────────────────┐
│                                 │    │                 │
│  Agent A ──── Phase 1 (ClawX)   │    │  Agent C        │
│              SSO 登录全流程      │──>│  验证 P1+P2     │
│              (Electron + React)  │    │  合并冲突文件    │
│                                 │    │  前端集成       │
│  Agent B ──── Phase 2-Backend   │──>│  (P2.S8~S10)    │
│              ClawX Backend (Go) │    │  E2E 测试       │
│              P2.S1~S7, S11      │    │                 │
│                                 │    └────────┬────────┘
└─────────────────────────────────┘             │
                                                ▼
                                    ┌─────────────────────┐
                                    │ 后续 Phase 3, 4     │
                                    │ 同理拆分             │
                                    └─────────────────────┘
```

---

## 为什么可以并发

Phase 2 的工作量分两块：

| 块 | Stories | 工作位置 | 与 Phase 1 冲突 |
|----|---------|---------|----------------|
| **Backend 块**（80% 工作量） | P2.S1~S7, S11 | 全新 Go 项目 `clawx-backend/` | **零冲突** |
| **前端块**（20% 工作量） | P2.S8~S10 | ClawX 仓库内 | **有冲突**，留给集成 Agent |

Backend 块是全新仓库，和 Phase 1 操作的 ClawX 仓库完全不交叉，所以可以安全并发。

---

## Agent A — Phase 1：SSO 登录

### 工作范围

| Story | 说明 |
|-------|------|
| P1.S1 | sureup_laravel 注册 ClawX SSO Client |
| P1.S2 | Electron Deep Link 协议注册 |
| P1.S3 | Main Process Auth Service + Token 存储 |
| P1.S4 | Host API Auth 路由 |
| P1.S5 | IPC 通道 + Renderer Auth Store |
| P1.S6 | 登录/登出 UI + 用户信息展示 |
| P1.S7 | Token 自动刷新 |
| P1.S8 | Settings 账户区块 |

### 操作的仓库/文件

- **sureup_laravel**：`config/sso.php`、`.env`
- **ClawX 仓库**：`electron/` 和 `src/` 中的 auth 相关文件

### 交付物

- SSO 完整登录/登出流程可用
- `electron/services/auth/` 目录全部文件
- Auth Store + Auth UI 组件
- Token 自动刷新机制

### 启动前提

无，可以直接开始。

---

## Agent B — Phase 2-Backend：LLM 代理后端

### 工作范围

| Story | 说明 |
|-------|------|
| P2.S1 | ClawX Backend 项目初始化 (Go + Gin) |
| P2.S2 | JWT 认证中间件 |
| P2.S3 | Provider 密钥管理与路由 |
| P2.S4 | LLM Proxy（非 Streaming） |
| P2.S5 | LLM Proxy（SSE Streaming） |
| P2.S6 | Usage 采集与日志 |
| P2.S7 | 模型定价表 |
| P2.S11 | 部署与健康检查 |

### 不做的 Story（留给 Agent C）

| Story | 原因 |
|-------|------|
| P2.S8 | 修改 ClawX `providers.ts`，与 Phase 1 i18n 冲突 |
| P2.S9 | 修改 ClawX `Settings/index.tsx` 和 `store.ts`，与 Phase 1 冲突 |
| P2.S10 | 修改 Phase 1 创建的 `auth-service.ts`，强依赖 Phase 1 完成 |

### 操作的仓库/文件

- **仅 `clawx-backend/` 新项目**，与 ClawX 仓库零交集

### 交付物

- 可独立运行的 Go 服务
- `POST /api/v1/llm/chat/completions` 代理端点可用（Streaming + 非 Streaming）
- JWT 认证中间件（调用 sureup_laravel checkjwt）
- Usage 日志采集
- 定价计算
- Docker 部署配置

### 启动前提

需要知道 sureup_laravel 的 `checkjwt` 接口格式（已在 PRD 中定义），不需要 Phase 1 完成。

### 验证方式（独立于 Phase 1）

Agent B 可以用 curl 或测试脚本独立验证 Backend：

```bash
# 1. 手动获取一个 JWT（从 sureup_laravel 登录）
TOKEN="eyJhbG..."

# 2. 测试非 Streaming
curl -X POST http://localhost:9090/api/v1/llm/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Provider: openai" \
  -H "X-Model: gpt-4o-mini" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}'

# 3. 测试 Streaming
curl -X POST http://localhost:9090/api/v1/llm/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Provider: openai" \
  -H "X-Model: gpt-4o-mini" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":true}'
```

---

## Agent C — 集成验证：合并 + 前端接入 + E2E

### 启动前提

Agent A 和 Agent B 都完成后启动。

### 工作范围

#### 第一步：验证 Phase 1

| 检查项 | 验证方式 |
|--------|---------|
| Deep Link 唤起 | macOS/Windows 浏览器访问 `clawx://auth/callback?code=test` |
| SSO 完整流程 | 点击登录 → 浏览器 → 输入凭据 → 回调 → 显示用户信息 |
| 冷启动恢复 | 重启应用，检查登录态是否保持 |
| Token 刷新 | 等待 token 接近过期，确认自动刷新 |
| 登出 | 点击退出登录，确认 token 清除 |

#### 第二步：验证 Phase 2 Backend

| 检查项 | 验证方式 |
|--------|---------|
| 健康检查 | `GET /health` 和 `GET /ready` |
| JWT 认证 | 有效/无效/过期 token 的请求 |
| 非 Streaming 代理 | 用 curl 发送 `stream: false` 请求 |
| SSE Streaming 代理 | 用 curl 发送 `stream: true` 请求 |
| Usage 日志 | 检查请求后有 usage 结构化日志 |
| 多 Provider 路由 | OpenAI / Anthropic / ARK 各发一个请求 |

#### 第三步：完成 Phase 2 前端接入（P2.S8~S10）

这是 Agent C 的**开发任务**，需要合并 Phase 1 的改动：

| Story | 操作 | 冲突文件处理 |
|-------|------|-------------|
| P2.S8 | 新增 `clawx-cloud` Provider 类型 | `src/lib/providers.ts` — 无冲突，直接加 |
| P2.S9 | 服务模式切换 UI | `Settings/index.tsx` — 在 P1.S8 的 Account 区块下方新增 ServiceMode 区块 |
| P2.S9 | serviceMode 配置 | `electron/utils/store.ts` — 在 P1 增加的 `authServerUrl` 旁边追加 `serviceMode` |
| P2.S10 | 登录后自动注入 Provider | `electron/services/auth/auth-service.ts` — 在 P1 创建的 `exchangeCode()` 方法末尾增加 Provider 创建逻辑 |
| P2.S8/S9 | i18n | `src/i18n/locales/*.json` — 追加翻译 key（P1 的 key 已存在） |

#### 第四步：端到端测试

| 场景 | 步骤 |
|------|------|
| 云端模式 Chat | 登录 → 自动创建 clawx-cloud Provider → Chat → 收到回复 |
| 模式切换 | 云端 → 本地 → Provider 列表变化正确 |
| 登出清理 | 登出 → clawx-cloud Provider 移除 |

---

## 冲突文件详细合并指南

Agent C 需要处理的冲突文件共 5 个：

### 1. `electron/utils/store.ts`

Phase 1 新增了 `authServerUrl`，Phase 2 需要追加 `serviceMode`：

```typescript
// Phase 1 已增加:
authServerUrl: string;

// Agent C 追加:
serviceMode: 'cloud' | 'local';
```

**冲突等级**：低 — 不同字段，追加即可

### 2. `src/pages/Settings/index.tsx`

Phase 1 新增了 Account 区块，Phase 2 需要新增 ServiceMode 区块：

```
// Phase 1 已增加 Account 区块
// Agent C 在 Account 区块下方新增 ServiceMode 区块
```

**冲突等级**：低 — 不同区块，位置不冲突

### 3. `electron/services/auth/auth-service.ts`

Phase 1 创建了此文件，Phase 2 需要在 `exchangeCode()` 成功后追加 Provider 注入逻辑：

```typescript
// Phase 1 的 exchangeCode():
async exchangeCode(code: string, state: string): Promise<void> {
  // ... Phase 1 逻辑: 兑换 token、存储、拉取用户信息
  
  // Agent C 在此追加:
  if (getServiceMode() === 'cloud') {
    await this.injectCloudProvider();
  }
}
```

**冲突等级**：中 — 需要理解 Phase 1 的实现后再追加

### 4. `src/i18n/locales/en.json`

```json
// Phase 1 已增加:
"auth.login": "Login",
"auth.logout": "Logout",
// ...

// Agent C 追加:
"settings.serviceMode": "Service Mode",
"settings.cloudMode": "Cloud Mode",
// ...
```

**冲突等级**：低 — 不同 key，追加即可

### 5. `src/i18n/locales/zh-CN.json`

同上。

---

## Phase 3 + Phase 4 的后续安排

Phase 1+2 集成验证完成后，同理可以继续：

```
Agent D ──── Phase 3-Backend        Agent F ──── 验证 P3
             Billing Client                      合并前端
             BFF 接口                            E2E 测试
             扣费/余额预检                         │
                                                  ▼
Agent E ──── Phase 3-Frontend       Agent G ──── Phase 4
             Wallet Store (mock)                  打磨 + 上线
             钱包页面 (mock)
             充值流程 (mock)
```

Phase 3 的前后端也可以并发：
- **Agent D**：Backend 侧 P3.S1~S6（Go 项目内，无冲突）
- **Agent E**：前端 P3.S7~S11（ClawX 仓库内，用 mock 数据先行）
- **Agent F**：前后端联调 + 验证

---

## 时间线总览

```
           Week 1          Week 2          Week 3          Week 4
         ─────────────── ─────────────── ─────────────── ───────────────

Agent A  ████████████████
         Phase 1 (SSO)
                         
Agent B  ████████████████████████████████
         Phase 2-Backend (Go)

Agent C                  ░░░░░░░░████████
                         验证P1  合并+前端接入+E2E

Agent D                          ████████████████████████
                                 Phase 3-Backend (Billing)

Agent E                          ████████████████
                                 Phase 3-Frontend (mock)

Agent F                                          ████████
                                                 P3 联调+验证

Agent G                                          ████████████████
                                                 Phase 4 (打磨)
```

**总工期：~4 周**（原始串行 ~7 周）

---

## Agent 启动 Prompt 模板

### Agent A 启动提示

```
你负责 ClawX Phase 1 — SSO 登录与用户信息展示。
完整 PRD 见 docs/prd/phase-1-sso-login.md。
按 P1.S1 → P1.S8 顺序执行所有 Story。
涉及仓库：ClawX（Electron + React）和 sureup_laravel。
不要修改 src/lib/providers.ts 和 src/stores/settings.ts。
```

### Agent B 启动提示

```
你负责 ClawX Phase 2-Backend — 新建 clawx-backend Go 项目。
完整 PRD 见 docs/prd/phase-2-llm-proxy.md。
只做 P2.S1 ~ P2.S7 和 P2.S11，共 8 个 Story。
不要做 P2.S8、P2.S9、P2.S10（这三个涉及 ClawX 前端，由集成 Agent 负责）。
项目完全独立，不要修改 ClawX 仓库的任何文件。
```

### Agent C 启动提示

```
你是集成验证 Agent，Phase 1 和 Phase 2-Backend 都已完成。
1. 先验证 Phase 1 SSO 流程（见 phase-1-sso-login.md 的测试检查清单）
2. 再验证 Phase 2 Backend（curl 测试 LLM Proxy）
3. 完成 Phase 2 的前端接入：P2.S8、P2.S9、P2.S10
4. 合并冲突文件（见 parallel-development-guide.md 的合并指南）
5. 端到端测试：登录 → 云端模式 → Chat → 收到回复
```
