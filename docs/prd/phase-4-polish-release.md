# Phase 4：打磨与上线

> 预估周期：1 周
> 前置依赖：Phase 3（Billing 计费与钱包）完成
> 涉及仓库：ClawX、ClawX Backend

---

## 目标

全链路就绪后，进行双模式测试、边界情况处理、国际化完善、离线降级、对账机制和部署监控，达到可发布状态。

---

## Story 列表

| ID | Story | 优先级 | 预估 |
|----|-------|--------|------|
| P4.S1 | 云端/本地双模式端到端测试 | P0 | 1d |
| P4.S2 | 离线与网络异常降级策略 | P0 | 1d |
| P4.S3 | 国际化翻译完善 | P1 | 0.5d |
| P4.S4 | 错误处理与边界情况 | P0 | 1d |
| P4.S5 | 扣费对账机制 | P1 | 1d |
| P4.S6 | 部署与监控 | P0 | 1d |

---

## P4.S1 — 云端/本地双模式端到端测试

### 描述

系统性测试两种服务模式下的全链路功能。

### 测试矩阵

| 场景 | 云端模式 | 本地模式 |
|------|---------|---------|
| Chat 发消息（Streaming） | ✅ | ✅ |
| Chat 发消息（非 Streaming） | ✅ | ✅ |
| 多轮对话 | ✅ | ✅ |
| 切换模型 | ✅ | ✅ |
| Token 用量展示 | ✅ (后端统计) | ✅ (本地统计) |
| Provider 配置 | 自动（无需配置） | 手动 API Key |
| 余额显示 | ✅ | 不显示 |
| 充值 | ✅ | 不适用 |
| 登出后行为 | 提示登录 | 无影响 |
| 模式切换后 Provider 列表 | clawx-cloud 出现/消失 | 本地 Provider 保留 |

### 平台测试

| 平台 | 覆盖范围 |
|------|---------|
| macOS (Apple Silicon) | 全功能 |
| macOS (Intel) | 核心链路 |
| Windows 10/11 | 全功能（特别是 Deep Link） |
| Linux (Ubuntu) | 核心链路 |

### 验收标准

- [AC-4101] 上述测试矩阵所有 ✅ 场景通过
- [AC-4102] 三个平台核心链路通过
- [AC-4103] 模式切换前后数据不丢失

---

## P4.S2 — 离线与网络异常降级策略

### 描述

处理网络不可用、Backend 宕机等异常场景下的用户体验。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/stores/auth.ts` | 修改 — 网络状态感知 |
| ClawX | `src/components/common/NetworkStatus.tsx` | 新增 |
| ClawX | `electron/services/auth/auth-service.ts` | 修改 — 离线时跳过刷新 |

### 降级策略

| 场景 | 云端模式行为 | 本地模式行为 |
|------|-------------|-------------|
| Backend 不可达 | 提示「云端服务暂时不可用」，建议切换到本地模式 | 不影响 |
| SSO 服务不可达 | 登录失败，已登录用户可继续使用（token 未过期） | 不影响 |
| Billing 不可达 | LLM 请求正常（扣费异步重试），钱包页面显示「加载失败」 | 不影响 |
| 完全离线 | 弹出离线提示，建议切换本地模式 | 不影响（如 API Key 对应 Provider 也不可达则另说） |
| Token 刷新失败 | 保留当前 token，下次请求重试 | 不影响 |

### 网络状态检测

```typescript
// 定期检测 Backend 可达性
const checkBackendHealth = async () => {
  try {
    await hostApiFetch('/api/auth/status');
    return true;
  } catch {
    return false;
  }
};
```

### 验收标准

- [AC-4201] 离线时不会出现空白页或未处理的 JS 错误
- [AC-4202] Backend 不可达时有明确提示
- [AC-4203] 自动切换到本地模式的建议可点击
- [AC-4204] 网络恢复后自动恢复（不需要手动刷新）

---

## P4.S3 — 国际化翻译完善

### 描述

确保 Phase 1~3 新增的所有 UI 文案都有中英文翻译。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/i18n/locales/en.json` | 修改 |
| ClawX | `src/i18n/locales/zh-CN.json` | 修改 |

### 需要覆盖的翻译模块

| 模块 | 示例 Key |
|------|----------|
| Auth | `auth.login`, `auth.logout`, `auth.loginRequired` |
| ServiceMode | `settings.serviceMode`, `settings.cloudMode`, `settings.localMode` |
| Wallet | `wallet.title`, `wallet.balance`, `wallet.recharge`, `wallet.transactions` |
| Billing | `wallet.insufficientBalance`, `wallet.rechargeSuccess` |
| Error | `error.networkUnavailable`, `error.backendDown`, `error.paymentTimeout` |

### 验收标准

- [AC-4301] 切换到英文后无中文残留
- [AC-4302] 切换到中文后无英文残留
- [AC-4303] 所有 i18n key 无缺失（运行时无 fallback 警告）

---

## P4.S4 — 错误处理与边界情况

### 描述

排查并修复全链路中的错误处理盲区。

### 需要覆盖的边界情况

| # | 场景 | 预期行为 |
|---|------|---------|
| 1 | SSO callback 中 state 不匹配 | 弹出错误提示，不执行 token 兑换 |
| 2 | SSO callback 中 code 已过期 | 提示「登录超时，请重试」 |
| 3 | JWT 刷新时 refresh_token 被撤销 | 自动登出，提示重新登录 |
| 4 | 并发多个 LLM 请求同时扣费 | 幂等键确保不重复扣费 |
| 5 | 支付中途关闭浏览器 | 提供手动同步按钮 |
| 6 | 产品价格为 0（测试包） | 正常处理，Mock 支付直接完成 |
| 7 | 钱包余额溢出（极端充值） | int64 范围，几乎不会发生 |
| 8 | Streaming 中途 Backend 崩溃 | 前端显示「连接中断」错误 |
| 9 | 用户多设备同时登录 | 各设备独立 token，不互相踢出 |
| 10 | 应用更新后 auth store 格式变更 | schema migration 或重新登录 |

### 验收标准

- [AC-4401] 上述 10 个场景都有明确的错误处理（不会 silent fail）
- [AC-4402] 所有用户可见的错误消息有 i18n

---

## P4.S5 — 扣费对账机制

### 描述

确保 LLM usage 与 billing 扣费一致，设计对账方案。

### 涉及文件

| 文件 | 操作 |
|------|------|
| `internal/service/billing/reconciliation.go`（Backend） | 新增 |

### 对账策略

1. **Usage 日志 vs Billing 交易**：定期比对 Backend 的 usage 日志与 billing 的交易记录
2. **日志字段**：每条 usage 记录包含 `requestId`（= billing 的 `bizId`）
3. **对账频率**：建议每日凌晨自动执行
4. **不一致处理**：
   - usage 有记录但 billing 无对应交易 → 补扣
   - billing 有交易但 usage 无记录 → 告警（可能是手动操作）

### Phase 4 最小实现

- 提供 CLI 命令或内部 API 手动触发对账
- 输出对账报告（匹配/不匹配/待补扣）
- 自动对账为后续迭代

### 验收标准

- [AC-4501] 对账命令可手动执行
- [AC-4502] 能检出缺失的扣费记录
- [AC-4503] 对账报告格式清晰

---

## P4.S6 — 部署与监控

### 描述

ClawX Backend 生产环境部署和基础监控。

### 部署架构

```
                   ┌──────────┐
                   │  Nginx   │
                   │  (HTTPS) │
                   └────┬─────┘
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
     ┌────────────────┐  ┌────────────────┐
     │ ClawX Backend  │  │ ClawX Backend  │
     │  Instance 1    │  │  Instance 2    │
     └───────┬────────┘  └───────┬────────┘
             │                   │
     ┌───────┴───────────────────┴───────┐
     │           Internal Network         │
     │  ┌──────────┐  ┌──────────────┐   │
     │  │ sureup_  │  │ arvio-       │   │
     │  │ laravel  │  │ billing      │   │
     │  └──────────┘  └──────────────┘   │
     └───────────────────────────────────┘
```

### 部署清单

- [ ] 域名申请与 DNS 配置
- [ ] HTTPS 证书（Let's Encrypt 或其他）
- [ ] Docker 镜像构建 CI/CD
- [ ] 容器编排（Docker Compose 或 K8s）
- [ ] 环境变量配置（生产/预发布）
- [ ] Nginx 反向代理配置（SSE 需关闭 buffering）

### 监控清单

| 监控项 | 方式 |
|--------|------|
| 服务存活 | `/health` 端点定期探活 |
| 依赖就绪 | `/ready` 端点（SSO + Billing 可达性） |
| 请求延迟 | 结构化日志（Zap）+ 指标 |
| LLM Proxy 错误率 | 日志中的 error 计数 |
| 扣费失败率 | 日志中的扣费失败计数 |

### ClawX 应用配置

发布包中需要内置生产环境的 Backend 地址：

```typescript
// electron/utils/config.ts 或构建时注入
const CLAWX_BACKEND_URL = process.env.CLAWX_BACKEND_URL || 'https://api.clawx.example.com';
```

### 验收标准

- [AC-4601] 生产环境可访问且 HTTPS 正常
- [AC-4602] `/health` 和 `/ready` 返回 200
- [AC-4603] Nginx SSE 不 buffer（实测 Streaming 正常）
- [AC-4604] ClawX 应用能连接到生产 Backend

---

## 全链路验收场景

Phase 4 完成后，以下端到端场景必须全部通过：

### 场景 A：新用户首次使用（云端模式）

```
1. 安装 ClawX → 启动
2. 点击「登录」→ 浏览器打开 SSO
3. 注册新账户 → SSO 回调 → 自动登录
4. 系统自动创建钱包（余额 0）
5. Sidebar 显示用户名 + 余额 0
6. 尝试 Chat → 余额不足弹窗
7. 充值 → 选择体验包 → 支付宝支付
8. 支付成功 → 余额更新为 100
9. Chat 发消息 → 收到 AI 回复
10. 查看钱包 → 交易记录显示充值 + 扣费
```

### 场景 B：老用户切换模式

```
1. 已登录用户（云端模式）
2. Settings → 服务模式 → 切换到本地模式
3. Models 页面 → 配置 OpenAI API Key
4. Chat → 使用本地 Provider → 正常
5. 切回云端模式 → Chat 恢复使用 clawx-cloud
```

### 场景 C：离线/网络异常

```
1. 断开网络
2. 云端模式 → Chat 发消息 → 提示「网络不可用」
3. 切换到本地模式 → 仍然不可用（Provider 也不可达）
4. 恢复网络
5. 自动恢复 → Chat 正常
```

### 场景 D：Token 过期

```
1. 模拟 Access Token 过期
2. Chat 发消息 → 自动刷新 token → 请求成功（用户无感知）
3. 模拟 Refresh Token 过期
4. Chat 发消息 → 自动登出 → 提示重新登录
```
