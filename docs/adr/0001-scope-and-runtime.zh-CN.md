# ADR 0001：桥的范围、运行时与结构

[English](0001-scope-and-runtime.md) · [简体中文](0001-scope-and-runtime.zh-CN.md)

- 状态：已接受
- 日期：2026-11-19

## 背景

训记提供面向 LLM agent 的个人训练数据 Open API：
每次 HTTP 调用读取一个日历日，bearer Key 绑定一个账号，没有查询语言。
目标是让 ChatGPT 和其他 MCP 客户端能够使用这些数据，
同时保持训记为权威源，不另建健身产品或重型前端。

影响该决定的约束：

- 厂商 Key 只属于一个人。公开多租户服务需要保管其他人的 Key，超出范围。
- 厂商按 Key/日期控制读取间隔：light 为 15 秒，`include_full_data` 为 30 秒。
  范围查询需要实际等待时间。
- 厂商写入端点可能用 HTTP 200 返回应用失败，并忽略 `dry_run`。
  发往该端点的每个请求都必须视为真实写入。
- MCP 授权使用 OAuth 2.1、受保护资源元数据、PKCE S256、
  resource indicator，以及越来越常见的 Client ID Metadata Documents。

## 决定

使用一个 Cloudflare Worker，同时作为 MCP 资源服务器和 OAuth 2.1 授权服务器，
采用两个维护中的库：

- `@cloudflare/workers-oauth-provider`：
  OAuth 发现、DCR、CIMD、PKCE、token 轮换、撤销、RFC 9207 `iss` 和 RFC 8707 `resource`。
- `@modelcontextprotocol/sdk`：MCP Streamable HTTP 端点。

Worker 将上游数据域 Key 保存在 secrets 中，标准化响应，
提供读取工具和明确启用的写工具。当前状态存储包括：

1. provider 管理的 `OAUTH_KV`，保存客户端、授权和 token。
2. `CACHE_KV` 保存今天/昨天的解包训练响应，按 subject 哈希和 light/full 模式隔离，
   并保存公开动作目录。
3. `UpstreamGate` Durable Objects 保存 subject/日期/模式的预约与冷却时间戳。
4. 可选 D1 `DB` 保存派生训练、动作、组、扫描状态、元数据和 UTC 日预算计数器。
5. 可选 `ScanCoordinator` Durable Object 用 alarm 循环处理 D1 扫描队列，支持恢复。

D1 支持分组查询、概览和动作进展，使分析时不必逐日请求上游。
扫描协调器提供后台回填/刷新。配置历史起点后，每日 cron 填补截至昨天的尾部范围。
训记保持权威地位，索引可通过成功读取重建。

公开仓库只保存通用代码和合成示例。
部署值放在 Git 忽略的 `wrangler.jsonc` 和 Worker secrets 中。
一个部署只对应一个账号，D1 schema 没有 subject 分区。

可选 MCP Apps 资源渲染概览工具已有的结构化结果。
它通过 `MCP_UI_ENABLED=true` 启用，需要 D1 和训练 read 访问，
不引入独立前端服务、网络请求或存储。

## 影响

- 旧版范围读取最多覆盖 31 天（概览/统计）或 62 天（动作历史），
  每次调用预算两次成功的未缓存读取，明确返回 `pending`/`deferred`。
  它们不读取 D1，也不推进持久游标；历史日期不写入热缓存。
- 索引查询执行有界 SQL 聚合并报告扫描覆盖。
  在部分索引上查询成功，不能证明该期间没有训练。
- 缓存写入使用 D1 预算，默认每个 UTC 日 300 次尝试；
  没有 D1 时跳过新缓存写入。
  扫描跳过 KV，默认每个 UTC 日尝试 100 个日期。
  这些是部署默认值，不是全账号配额保证。
- 单租户边界明确。多用户需要每个用户独立厂商 Key 和不同的威胁模型，
  当前代码不提供这种支持。
- 训练写入仅在启用训练、read scope、`WRITE_TOOLS_ENABLED=true`
  和 write scope 时注册；调用要求 `confirmed: true`。
  它们不更新 D1，也不会使 full 缓存条目失效。
- 厂商没有删除 API，桥不声称支持删除。
  纠正通过 `localid` upsert，删除在训记 App 中进行。
- 独立身体/饮食适配器可选，未验证真实响应；需要自己的 Key 和数据域标记。
- D1 单日替换跨多个批次，不是包含全部数据和扫描状态的单个事务。
  刷新后操作者必须检查覆盖状态。

另见[架构](../architecture.zh-CN.md)、[覆盖说明](../coverage.zh-CN.md)
和 [ADR 0003](0003-upstream-contract-and-write-safety.zh-CN.md)。
