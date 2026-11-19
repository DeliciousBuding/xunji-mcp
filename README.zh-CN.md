# xunji-mcp（训记训练数据 MCP 桥）

一个轻量、自托管、**agent-native** 的 [Model Context Protocol](https://modelcontextprotocol.io) 桥，把[训记](https://xunjiapp.cn)的训练数据以只读为主的工具暴露给 ChatGPT 等 MCP 客户端。跑在 Cloudflare Workers 上，使用标准 OAuth 2.1。

它不是健身 App，不做第二份事实源，也不做多租户。训记 API Key 只存在 Worker Secret 里，客户端拿到的是 OAuth 授权，永远拿不到 Key。

- [English README](README.md)
- [架构](docs/architecture.md) · [威胁模型](docs/threat-model.md) · [工具说明](docs/tools.md) · [部署](docs/deployment.md) · [ChatGPT 接入](docs/chatgpt-connect.md)

## 提供什么

| 工具 | 用途 |
|---|---|
| `xunji_capabilities` | 本部署暴露哪些数据域、有哪些限制 |
| `xunji_get_training_day` | 某一天：动作、组、容量、时长，可选完整明细 |
| `xunji_list_training_days` | 日期区间的每日概览（≤31 天） |
| `xunji_movement_history` | 单个动作的历史轨迹（≤62 天） |
| `xunji_training_stats` | 训练次数、组数、容量、星期分布、高频动作 |
| `xunji_search_movements` | 从公开动作库查标准中文名 |
| `xunji_list_plans` / `xunji_get_plan` | 官方计划日程，只读 |
| `xunji_upsert_training_day` | 可选写入，**默认关闭** |

返回的是紧凑、字段稳定的 JSON，不是上游原始大 payload。某天没有训练是成功的空结果，不是错误；每次读取都带上游限频与缓存状态。

## 为什么这样设计

训记按「同一账号 + 同一训练日」限频：普通读取 15 秒一次，`include_full_data` 30 秒一次，而且没有区间接口。因此：

- 按身份隔离缓存已归一化的每日数据；
- 通过 Durable Object 串行化读取并预占上游名额；
- 等待过久时返回带 `retryAfterSeconds` 的结构化 `deferred`，而不是挂住请求；
- 区间工具每次最多做 2 次未命中的上游读取，并明确返回 `pending` 日期。

写入极其保守。2026-11-19 实测：训练写入接口**忽略 `dry_run`**，所谓“预览”同样会真实写入。本项目从不发送该字段，必须 `confirmed: true`，拒绝六个月以外的日期，且不提供删除（上游没有删除接口）。

饮食、身体数据使用独立的训记 Key，本桥不暴露这些数据域，也不伪造接口。

## 本地起步

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # 修改 origin 与 KV id
npx wrangler types
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
printf 'owner-passphrase' | npx wrangler secret put OWNER_PASSPHRASE
printf 'your-xunji-key'   | npx wrangler secret put XUNJI_API_KEY
npm run typecheck && npm test
npm run dev
```

本地 `wrangler dev` 的 MCP 端点是 `http://localhost:8787/mcp`；OAuth 元数据使用 `PUBLIC_ORIGIN`，本地联调时把它设为 `http://localhost:8787`。

## 安全基线

- OAuth 2.1 授权码 + PKCE S256、精确 redirect URI、`resource` 受众、`iss`、refresh 轮换与撤销，使用成熟的 [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)。
- 授权必须由本人完成：Cloudflare Access JWT（校验签名、issuer、aud、过期与邮箱 allowlist），或部署口令。无身份即无授权，没有“允许所有人”开关。
- 单用户设计，缓存按身份隔离。
- 日志不含原始 payload、Key 或 token；`/healthz` 只返回布尔状态。
- 默认只读；写入需要 `WRITE_TOOLS_ENABLED=true`、`xunji:write` scope 与用户显式确认。

公开部署前请阅读 [SECURITY.md](SECURITY.md) 与 [docs/threat-model.md](docs/threat-model.md)。

## 状态

协议与上游行为有单元、契约与 workerd 集成测试覆盖。ChatGPT 的真实连接按部署逐一验证，不由本仓库代为宣称；具体验收项与当前状态见 [docs/acceptance.md](docs/acceptance.md)。

## 许可

MIT。训记及其标识归其权利人所有，本项目与官方无隶属关系。
