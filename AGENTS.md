# AGENTS.md — xunji-mcp

最后更新：2026-11-19 15:20

本项目是训记（Xunji）训练数据 Open API 的通用、自托管、agent-native MCP 桥。它不复制训记为事实源，不做健身业务系统，不做重型前端；公开仓库只含通用代码与合成样例，部署实例的域名、密钥与账号信息一律不进 Git。

## 边界

- 上游契约只写已核实部分：`docs/api-contract.md` 记录观察到的请求/响应、限频与错误形态；未核实的接口不实现、不写入工具描述。
- 训练写入接口忽略 `dry_run`（2026-11-19 实测）。任何写路径都必须视为真实写入：默认不注册写工具，必须 `WRITE_TOOLS_ENABLED=true` 且 token 带 `xunji:write`，并要求 `confirmed: true`。禁止发送 `dry_run`。
- 桥不提供删除（上游无删除接口），也不声称能删除；纠正只能靠 `localid` upsert 或让用户在训记 App 内处理。
- 饮食/身体数据使用独立 Key，本桥不暴露、不伪造；启用前必须有对应 Key 与真实核验。
- 单用户设计：一个部署只对应一个训记账号与一把 Key。缓存按 subject 哈希隔离，不得引入按请求传入的用户标识。

## 安全

- OAuth 由 `@cloudflare/workers-oauth-provider` 负责；不得手写 token 签发、PKCE 校验或静态万能 token。`/authorize` 必须验证操作者身份（Access JWT + 邮箱 allowlist，或部署口令），无配置时 fail closed。
- 训记 Key 只放 Worker secret；不得进入代码、日志、缓存键、OAuth props、测试 fixture 或公开文档。
- 日志只记录工具名、状态码、耗时；不记录请求体、上游 payload、日期、训练内容、邮箱或 token。
- 任何真实数据核验只做只读，且只报告计数/聚合，不粘贴内容。

## 工程

- 运行 `npm run typecheck && npm test`；测试在 workerd 中通过 `@cloudflare/vitest-pool-workers` 执行，上游 HTTP 必须用 stub，不得访问真实账号。
- 契约或行为变化时同步 `docs/`、`docs/acceptance.md` 与 `CHANGELOG.md`。
- 提交前跑 `node scripts/secret-scan.mjs --history`；公开仓库不得出现真实域名、邮箱、Key、账号或训练记录。
- 范围工具必须保持有界：≤31 天概览/统计、≤62 天动作历史、每次最多 2 次未命中上游读取，并显式返回 `pending`/`deferred`。

## 入口

- 架构：`docs/architecture.md`
- 威胁模型：`docs/threat-model.md`
- 工具契约：`docs/tools.md`
- 部署：`docs/deployment.md`
- ChatGPT 接入：`docs/chatgpt-connect.md`
- 验收：`docs/acceptance.md`
