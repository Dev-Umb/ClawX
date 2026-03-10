# ClawX 定制化改造 — PRD 分片索引

> 基于 [customization-proposal.md](../customization-proposal.md) 拆分

## 交付阶段

| Phase | 标题 | 预估周期 | 前置依赖 | 文档 |
|-------|------|---------|---------|------|
| 1 | [SSO 登录与用户信息](./phase-1-sso-login.md) | 1~1.5 周 | 无 | `phase-1-sso-login.md` |
| 2 | [后端 LLM 代理服务](./phase-2-llm-proxy.md) | 2~2.5 周 | Phase 1 完成 | `phase-2-llm-proxy.md` |
| 3 | [Billing 计费与钱包](./phase-3-billing-wallet.md) | 1.5~2 周 | Phase 2 完成 | `phase-3-billing-wallet.md` |
| 4 | [打磨与上线](./phase-4-polish-release.md) | 1 周 | Phase 3 完成 | `phase-4-polish-release.md` |

## 依赖关系

```
Phase 1 (SSO)
    │
    ▼
Phase 2 (LLM Proxy)  ← 需要 JWT 认证基础设施
    │
    ▼
Phase 3 (Billing)    ← 需要 LLM Proxy 的 usage 数据
    │
    ▼
Phase 4 (Polish)     ← 全链路就绪后打磨
```

## 并发开发

详见 [parallel-development-guide.md](./parallel-development-guide.md)。

**策略**：一个 Agent 负责一个 Phase，并发完成后用新 Agent 验证集成。

- **Agent A**：Phase 1 全部（ClawX SSO 登录）
- **Agent B**：Phase 2 Backend 部分（P2.S1~S7, S11，全新 Go 项目，与 Phase 1 零冲突）
- **Agent C**：验证 P1 + P2，合并冲突文件，完成 P2 前端接入（P2.S8~S10），E2E 测试
- Phase 3/4 同理拆分，总工期 ~4 周（原 7 周）

## 约定

- 每个 Phase 文档内的 Story 使用 `P{phase}.S{story}` 编号（如 `P1.S3`）
- 每个 Story 标注优先级 `P0`（必须）/ `P1`（应该）/ `P2`（可选）
- 验收标准使用 `[AC-xxx]` 格式引用
