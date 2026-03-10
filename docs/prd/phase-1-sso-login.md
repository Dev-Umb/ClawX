# Phase 1：SSO 登录与用户信息展示

> 预估周期：1~1.5 周
> 前置依赖：无
> 涉及仓库：ClawX、sureup_laravel

---

## 目标

为 ClawX 引入用户身份体系，通过 sureup_laravel 的 SSO 服务实现登录/登出，并在应用内展示用户信息。为后续 Phase 2/3 的认证鉴权打下基础。

---

## Story 列表

| ID | Story | 优先级 | 预估 |
|----|-------|--------|------|
| P1.S1 | sureup_laravel 注册 ClawX SSO Client | P0 | 0.5d |
| P1.S2 | Electron Deep Link 协议注册 | P0 | 0.5d |
| P1.S3 | Main Process Auth Service 与 Token 存储 | P0 | 1d |
| P1.S4 | Host API Auth 路由 | P0 | 0.5d |
| P1.S5 | IPC 通道注册与 Renderer Auth Store | P0 | 1d |
| P1.S6 | 登录/登出 UI 与用户信息展示 | P0 | 1.5d |
| P1.S7 | Token 自动刷新机制 | P1 | 1d |
| P1.S8 | Settings 账户管理区块 | P1 | 0.5d |

---

## P1.S1 — sureup_laravel 注册 ClawX SSO Client

### 描述

在 sureup_laravel 的 SSO 配置中注册 ClawX 桌面客户端，支持 `clawx://` 协议回调。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| sureup_laravel | `config/sso.php` | 修改 — 新增 `clawx` client 配置 |
| sureup_laravel | `.env` / `.env.example` | 修改 — 新增 `SSO_CLIENT_CLAWX_SECRET` |

### 实现要点

```php
// config/sso.php → clients
'clawx' => [
    'name' => 'ClawX Desktop',
    'secret' => env('SSO_CLIENT_CLAWX_SECRET'),
    'redirect_uris' => [
        'clawx://auth/callback',
    ],
],
```

### 验收标准

- [AC-101] `config/sso.php` 中存在 `clawx` client 配置
- [AC-102] `redirect_uris` 包含 `clawx://auth/callback`
- [AC-103] `.env.example` 中有 `SSO_CLIENT_CLAWX_SECRET` 占位
- [AC-104] 确认 `SsoService::validateRedirectUri()` 支持非 HTTP scheme（`clawx://`）；若不支持需修复

### 风险

- sureup_laravel 的 `validateRedirectUri()` 可能校验 scheme 必须为 `http/https`，需要先确认

---

## P1.S2 — Electron Deep Link 协议注册

### 描述

在 Electron 主进程中注册 `clawx://` 自定义协议，使得 SSO 登录完成后浏览器重定向回应用时能被正确捕获。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `electron/main/index.ts` | 修改 — 注册协议 + 事件监听 |
| ClawX | `electron/main/auth-callback.ts` | 新增 — Deep Link URL 解析与分发 |

### 实现要点

1. **协议注册**：`app.setAsDefaultProtocolClient('clawx')`
2. **macOS**：监听 `app.on('open-url')` 事件
3. **Windows/Linux**：监听 `app.on('second-instance')` 事件，从 `argv` 提取 URL
4. **单实例保护**：确保 `app.requestSingleInstanceLock()` 已启用（ClawX 应已有）
5. **URL 解析**：从 `clawx://auth/callback?code=xxx&state=yyy` 提取 `code` 和 `state`

### `auth-callback.ts` 核心逻辑

```typescript
export function handleAuthCallback(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== 'auth' || parsed.pathname !== '/callback') return;

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  if (!code || !state) return;

  // 发送到 Auth Service 处理 code → token
  authService.exchangeCode(code, state);

  // 聚焦主窗口
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}
```

### 验收标准

- [AC-201] macOS 下浏览器访问 `clawx://auth/callback?code=test&state=test` 能唤起 ClawX 应用
- [AC-202] Windows 下同上（通过 `second-instance` 事件）
- [AC-203] 应用已在前台运行时，Deep Link 能聚焦主窗口
- [AC-204] `state` 参数与发起登录时生成的值不匹配时，忽略回调并记录警告日志

---

## P1.S3 — Main Process Auth Service 与 Token 存储

### 描述

在 Electron 主进程中实现完整的 Auth 生命周期管理：code 兑换 token、token 持久化存储、用户信息获取、登出清理。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `electron/services/auth/auth-store.ts` | 新增 — electron-store 实例，持久化 token/用户信息 |
| ClawX | `electron/services/auth/auth-service.ts` | 新增 — SSO 业务逻辑 |
| ClawX | `electron/services/auth/types.ts` | 新增 — 类型定义 |
| ClawX | `electron/utils/store.ts` | 修改 — AppSettings 增加 `authServerUrl` |

### 类型定义 (`types.ts`)

```typescript
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;         // Unix ms
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  phone?: string;
}

export interface AuthState {
  tokens: AuthTokens | null;
  user: UserProfile | null;
  loginState: string | null;  // SSO state 参数，防 CSRF
}
```

### Auth Store (`auth-store.ts`)

- 使用 `electron-store` 创建独立实例 `clawx-auth`
- 敏感 token 使用 `safeStorage.encryptString()` 加密存储
- 提供 `getTokens()`, `setTokens()`, `clearTokens()`, `getUser()`, `setUser()` 方法

### Auth Service (`auth-service.ts`) 核心方法

| 方法 | 说明 |
|------|------|
| `initiateLogin()` | 生成 state → 拼接 SSO URL → `shell.openExternal()` |
| `exchangeCode(code, state)` | 校验 state → `POST /api/v1/sso/token` → 存储 token → 拉取用户信息 |
| `fetchUserProfile()` | `GET /api/v1/me` + Bearer token → 存储用户信息 |
| `refreshAccessToken()` | `POST /api/v1/refresh` + refresh_token → 更新 token |
| `logout()` | 清除本地 token 和用户信息 |
| `getAuthStatus()` | 返回当前登录状态 + 用户信息 |
| `isAuthenticated()` | token 是否存在且未过期 |

### 配置项

在 `AppSettings` 中新增：

```typescript
authServerUrl: string;  // SSO 服务地址，如 'https://auth.example.com'
```

client_id / client_secret 从环境变量或内置配置读取（不暴露给用户编辑）。

### 验收标准

- [AC-301] `exchangeCode()` 成功后 token 被加密持久化到 `clawx-auth` store
- [AC-302] 应用重启后 `getAuthStatus()` 能恢复登录态（token 未过期时）
- [AC-303] `logout()` 调用后 `clawx-auth` store 中 token 和用户信息被完全清除
- [AC-304] `state` 参数不匹配时 `exchangeCode()` 抛出明确错误
- [AC-305] SSO 服务不可达时给出清晰的错误信息（不是空白崩溃）

---

## P1.S4 — Host API Auth 路由

### 描述

在 Main Process 的 Host API Server 中新增 Auth 相关的 HTTP 路由，供 Renderer 通过 IPC 代理调用。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `electron/api/routes/auth.ts` | 新增 — Auth 路由处理 |
| ClawX | `electron/api/server.ts` | 修改 — 注册 auth 路由 |
| ClawX | `electron/api/context.ts` | 修改 — HostApiContext 增加 authService |

### 路由定义

| 方法 | 路径 | Handler | 说明 |
|------|------|---------|------|
| GET | `/api/auth/status` | `handleGetAuthStatus` | 返回 `{ authenticated, user }` |
| POST | `/api/auth/login` | `handleLogin` | 发起 SSO，返回 `{ success: true }` |
| POST | `/api/auth/callback` | `handleCallback` | 处理 code 兑换（也可由 Deep Link 直接触发） |
| POST | `/api/auth/refresh` | `handleRefresh` | 刷新 access token |
| POST | `/api/auth/logout` | `handleLogout` | 登出 |

### 验收标准

- [AC-401] `GET /api/auth/status` 未登录时返回 `{ authenticated: false, user: null }`
- [AC-402] `GET /api/auth/status` 已登录时返回用户完整信息
- [AC-403] `POST /api/auth/login` 调用后系统默认浏览器打开 SSO 登录页
- [AC-404] `POST /api/auth/logout` 调用后状态回到未登录

---

## P1.S5 — IPC 通道注册与 Renderer Auth Store

### 描述

注册统一 IPC 通道，并在 Renderer 侧创建 Zustand Auth Store，封装登录状态管理。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `electron/main/ipc-handlers.ts` | 修改 — 注册 `auth:*` 通道到统一 handler |
| ClawX | `src/stores/auth.ts` | 新增 — Zustand Auth Store |
| ClawX | `src/lib/api-client.ts` | 修改 — `UNIFIED_CHANNELS` 增加 auth 通道 |

### IPC 通道

在 `UNIFIED_CHANNELS` Set 中新增：

```
'auth:status'
'auth:login'
'auth:logout'
'auth:refresh'
```

### Renderer Auth Store (`src/stores/auth.ts`)

```typescript
interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: UserProfile | null;
  error: string | null;

  // Actions
  checkAuth: () => Promise<void>;       // 启动时调用
  login: () => Promise<void>;           // 发起 SSO 登录
  logout: () => Promise<void>;          // 登出
  refreshToken: () => Promise<void>;    // 刷新 token
  onAuthCallback: () => Promise<void>;  // Deep Link 回调后刷新状态
}
```

### 事件通知机制

Auth 状态变更（登录/登出/token 刷新）需要通知 Renderer。方案：

1. Auth Service 变更后通过 `eventBus.emit('auth:changed')` 触发
2. Host API SSE 端点 `/api/events` 推送 `auth:changed` 事件
3. Renderer 的 Auth Store 监听此事件并自动 `checkAuth()`

### 验收标准

- [AC-501] Renderer 中 `useAuthStore().checkAuth()` 能正确获取 Main Process 的登录状态
- [AC-502] SSO 登录回调完成后，Renderer 的 auth status 自动更新为 `authenticated`
- [AC-503] 登出后 Renderer 的 status 自动变为 `unauthenticated`
- [AC-504] 应用冷启动时自动检查登录态并恢复

---

## P1.S6 — 登录/登出 UI 与用户信息展示

### 描述

在应用界面中展示登录入口和用户信息，主要触点在 Sidebar 底部和 Settings 页面。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/components/auth/LoginButton.tsx` | 新增 |
| ClawX | `src/components/auth/UserAvatar.tsx` | 新增 |
| ClawX | `src/components/auth/LoginRequired.tsx` | 新增 |
| ClawX | `src/components/layout/Sidebar.tsx` | 修改 — 底部增加用户区域 |
| ClawX | `src/App.tsx` | 修改 — 启动时初始化 Auth Store |
| ClawX | `src/i18n/locales/en.json` | 修改 — 新增翻译 key |
| ClawX | `src/i18n/locales/zh-CN.json` | 修改 — 新增翻译 key |

### UI 规格

#### Sidebar 底部（未登录态）

```
┌─────────────────────┐
│  [用户图标] 登录      │  ← 点击发起 SSO
│                     │
└─────────────────────┘
```

#### Sidebar 底部（已登录态）

```
┌─────────────────────┐
│  [头像] 张三         │
│  zhang@example.com  │  ← 点击展开下拉菜单
│  ─────────────────  │
│  个人设置            │
│  退出登录            │
└─────────────────────┘
```

#### LoginRequired 组件

当云端模式功能（Phase 2/3）要求登录但用户未登录时展示：

```
┌─────────────────────────────────┐
│  🔒 需要登录                     │
│  此功能需要登录后使用             │
│  [登录] 按钮                     │
└─────────────────────────────────┘
```

### i18n Keys

```json
{
  "auth.login": "登录",
  "auth.logout": "退出登录",
  "auth.loginRequired": "需要登录",
  "auth.loginRequiredDesc": "此功能需要登录后使用",
  "auth.loggingIn": "登录中…",
  "auth.accountSettings": "账户设置"
}
```

### 验收标准

- [AC-601] 未登录时 Sidebar 底部显示「登录」按钮
- [AC-602] 点击「登录」后系统浏览器打开 SSO 页面
- [AC-603] SSO 完成后应用自动切换为已登录态，显示用户名和头像
- [AC-604] 点击用户区域展开菜单，可选择「退出登录」
- [AC-605] 退出后回到未登录态
- [AC-606] 中英文翻译完整，切换语言后正确显示

---

## P1.S7 — Token 自动刷新机制

### 描述

Access Token 即将过期时自动刷新，避免用户操作中断。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `electron/services/auth/auth-service.ts` | 修改 — 增加定时刷新逻辑 |
| ClawX | `electron/services/auth/token-refresh.ts` | 新增 — 刷新调度器 |

### 实现要点

1. **主动刷新**：Access Token 过期前 5 分钟自动刷新
2. **被动刷新**：任何 API 调用返回 401 时触发刷新并重试一次
3. **刷新锁**：同一时刻只允许一个刷新请求，其他请求等待结果
4. **刷新失败处理**：
   - Refresh Token 也过期 → 清除登录态，提示用户重新登录
   - 网络不可用 → 保留 token，下次请求时重试

### 验收标准

- [AC-701] Access Token 过期前自动刷新，用户无感知
- [AC-702] Refresh Token 过期后自动登出并提示
- [AC-703] 并发请求同时遇到 401 时，只发起一次刷新

---

## P1.S8 — Settings 账户管理区块

### 描述

在 Settings 页面新增「账户」区块，展示已登录用户信息和登录/登出操作。

### 涉及文件

| 仓库 | 文件 | 操作 |
|------|------|------|
| ClawX | `src/pages/Settings/index.tsx` | 修改 — 新增 Account 区块 |

### UI 规格

在 Settings 页面的 **Appearance** 区块之前，新增 **Account** 区块：

**未登录态：**
```
Account
─────────────────────
You are not logged in.
[Login] 按钮
```

**已登录态：**
```
Account
─────────────────────
[头像]  张三
        zhang@example.com
        
[Logout] 按钮
```

### 验收标准

- [AC-801] Settings 页面存在 Account 区块
- [AC-802] 未登录时显示登录引导
- [AC-803] 已登录时显示用户信息和登出按钮

---

## 文件清单汇总

### 新增文件

| 文件 | Story |
|------|-------|
| `electron/main/auth-callback.ts` | P1.S2 |
| `electron/services/auth/types.ts` | P1.S3 |
| `electron/services/auth/auth-store.ts` | P1.S3 |
| `electron/services/auth/auth-service.ts` | P1.S3 |
| `electron/services/auth/token-refresh.ts` | P1.S7 |
| `electron/api/routes/auth.ts` | P1.S4 |
| `src/stores/auth.ts` | P1.S5 |
| `src/components/auth/LoginButton.tsx` | P1.S6 |
| `src/components/auth/UserAvatar.tsx` | P1.S6 |
| `src/components/auth/LoginRequired.tsx` | P1.S6 |

### 修改文件

| 文件 | Story |
|------|-------|
| `electron/main/index.ts` | P1.S2 |
| `electron/api/server.ts` | P1.S4 |
| `electron/api/context.ts` | P1.S4 |
| `electron/main/ipc-handlers.ts` | P1.S5 |
| `electron/utils/store.ts` | P1.S3 |
| `src/lib/api-client.ts` | P1.S5 |
| `src/components/layout/Sidebar.tsx` | P1.S6 |
| `src/App.tsx` | P1.S5, P1.S6 |
| `src/pages/Settings/index.tsx` | P1.S8 |
| `src/i18n/locales/en.json` | P1.S6 |
| `src/i18n/locales/zh-CN.json` | P1.S6 |

### sureup_laravel 修改

| 文件 | Story |
|------|-------|
| `config/sso.php` | P1.S1 |
| `.env` / `.env.example` | P1.S1 |

---

## 测试检查清单

- [ ] macOS + Windows 下 Deep Link 唤起正常
- [ ] SSO 完整流程：点击登录 → 浏览器 → 输入凭据 → 回调 → 显示用户信息
- [ ] 应用冷启动恢复已登录状态
- [ ] Token 刷新不中断用户操作
- [ ] Refresh Token 过期后优雅降级为未登录
- [ ] 登出后所有本地 token 被清除
- [ ] 网络断开时不会崩溃，有清晰的错误提示
- [ ] 中英文切换正常
