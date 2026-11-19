<p align="center"><img src="assets/icon.png" alt="xunji-mcp icon" width="96" height="96"></p>

# xunji-mcp（训记训练数据 MCP 桥）

[![CI](https://github.com/DeliciousBuding/xunji-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/DeliciousBuding/xunji-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![MCP](https://img.shields.io/badge/MCP-streamable%20HTTP-blue.svg)](https://modelcontextprotocol.io)

一个轻量、自托管、**agent-native** 的 [Model Context Protocol](https://modelcontextprotocol.io) 桥，把[训记](https://xunjiapp.cn)的训练数据以只读为主的工具暴露给 ChatGPT 等 MCP 客户端。跑在 Cloudflare Workers 上，使用标准 OAuth 2.1，并带一个可重建的派生分析索引。

它不是健身 App，不做第二份事实源，也不做多租户。训记 API Key 只存在 Worker Secret 里，客户端拿到的是 OAuth 授权，永远拿不到 Key。训记仍是唯一权威源，索引可随时重建。

- [English](README.md) · [架构](docs/architecture.md) · [工具](docs/tools.md) · [覆盖矩阵](docs/coverage.md) · [基准](docs/benchmark.md) · [部署](docs/deployment.md) · [ChatGPT 接入](docs/chatgpt-connect.md)

## 给 Agent 的能力

0.2 的重点不是逐个包装 REST endpoint，而是一次调用回答分析问题：

| 工具                                                                           | 用途                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `xunji_capabilities`                                                           | 实时的 endpoint × tool × scope × 是否配置 × 是否验证矩阵，以及索引覆盖 |
| `xunji_training_overview`                                                      | 全历史 KPI：训练次数、组数、容量、时长、近四周趋势、高频动作           |
| `xunji_query_training`                                                         | 声明式查询：区间 × 动作/肌群 × 日/周/月/年 × 指标                      |
| `xunji_movement_progress`                                                      | 最佳组、Epley 估计 1RM、PR 时间线、月度容量、平台期启发式              |
| `xunji_history`                                                                | 索引覆盖与可断点续跑的后台回填/刷新                                    |
| `xunji_get_training_day`                                                       | 单日下钻，可选完整明细                                                 |
| `xunji_search_movements`                                                       | 标准中文动作名                                                         |
| `xunji_list_plans` / `xunji_get_plan`                                          | 官方计划，只读                                                         |
| `xunji_list_training_days` / `xunji_training_stats` / `xunji_movement_history` | 0.1 兼容的有限窗口工具                                                 |
| `xunji_upsert_training_day`                                                    | 可选写入，仅 **`WRITE_TOOLS_ENABLED=true`** 时注册                     |

查询结果使用列式 `columns`/`rows`、明确单位与指标口径、覆盖与新鲜度，并在文本字段只放简短摘要，不在 content 与 structuredContent 里重复大 JSON。空日与未扫描日是两种不同状态。

## 为什么长这样

训记按「账号 + 训练日」限频（普通 15 秒 / 完整 30 秒），没有区间或批量接口。让 MCP 客户端逐日扫多年会产生数百次往返，所以桥：

1. 维护 **D1 派生索引**（`session`、`movement`、`set_fact`、`scan_day`）；
2. 由 **Durable Object alarm 循环**后台回填，可断点续跑、幂等；
3. 聚合在 SQLite 内完成，不把每组数据塞进模型上下文；
4. 单独报告 `coverage`：未扫描日期不会被默默当成 0；
5. 全历史概览保持 **一次工具调用**、数百 token；
6. 每个 UTC 日最多扫描 **100 天**，扫描路径**不写 KV**。

Cloudflare 免费 KV 额度由账户内所有 Worker 共享，且瓶颈在写（1,000/天）。因此热键缓存有 **300 写/天**预算，只缓存今天/昨天；历史读取走 D1。扫描只写 D1。

基于合成历史的实测：

| 历史 | 0.1 调用数 |      0.1 输出 | 0.2 调用数 |   0.2 输出 |
| ---- | ---------: | ------------: | ---------: | ---------: |
| 1 年 |        183 |  ~43.8k token |          1 | ~552 token |
| 3 年 |        548 | ~131.4k token |          1 | ~555 token |

方法与限制见 [docs/benchmark.md](docs/benchmark.md)。

写入极其保守：训记训练写入接口**忽略 `dry_run`**（2026-11-19 实测），所谓预览就是真实写入。本项目从不发送该字段，必须 `confirmed: true`，拒绝六个月以外的日期，且不提供删除（上游没有删除接口）。

## 本地起步

```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc   # 修改 origin 与资源 id
npx wrangler types
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
npx wrangler d1 create xunji-mcp-index
npx wrangler d1 migrations apply xunji-mcp-index --remote
printf 'owner-passphrase' | npx wrangler secret put OWNER_PASSPHRASE
printf 'your-xunji-key'   | npx wrangler secret put XUNJI_API_KEY
npm run check
npm run dev
```

连接客户端后调用 `xunji_history`，例如
`{"action":"backfill","start":"2024-01-01"}`。扫描在后台继续，用
`action=status` 查询进度。`start` 是你愿意声称为已覆盖的窗口起点；更早的日期不会被暗示已覆盖。

`npm run bench` 可复现合成基准。

## 覆盖与边界

- **训练**：单日读取、索引查询、PR/e1RM、官方计划、动作库。
- **身体/饮食**：按官方 skill 实现了适配器，但需要单独的训记 Key；未配置时工具不注册，且在有真实响应前标记为未验证。
- **模板与写入**：默认不覆盖。写入需要显式开启，且只在 mock 中验证。
- **不提供删除**：上游没有删除接口，桥不声称能删除。
- **单用户**：缓存与索引绑定一个部署所有者。

`xunji_capabilities` 是机器可读的事实源；[docs/coverage.md](docs/coverage.md) 是表格版。

## 安全基线

- OAuth 2.1 授权码 + PKCE S256、精确 redirect URI、`resource` 受众、`iss`、refresh 轮换与撤销，使用成熟的 [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)。
- 授权必须由本人完成：Cloudflare Access JWT（校验签名、issuer、aud、过期与邮箱 allowlist），或部署口令。无身份即无授权，没有“允许所有人”开关。
- 缓存与索引按身份隔离；日志不含原始 payload、Key 或 token。
- `/healthz` 只返回布尔状态；`/admin/*` 使用独立 operator token，只返回计数。
- 默认只读；写入需要 `WRITE_TOOLS_ENABLED=true`、`xunji:write` scope 与用户显式确认。

公开部署前请阅读 [SECURITY.md](SECURITY.md) 与 [docs/threat-model.md](docs/threat-model.md)。

## 状态

57 个单元、契约与 workerd 集成测试；CI 覆盖 typecheck、ESLint、Prettier、测试、secret scan 与运行时依赖审计。2026-11-19 私有部署已完成 Cloudflare Access 下的 OAuth、ChatGPT 连接与真实只读调用；0.2 索引已回填并通过部署端点查询。兼容性仍按部署逐一验证，详见 [docs/acceptance.md](docs/acceptance.md)。

## 许可

MIT。训记及其标识归其权利人所有，本项目与官方无隶属关系。
