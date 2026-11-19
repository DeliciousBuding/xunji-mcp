# 安全政策

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md)

## 报告漏洞

请使用 [GitHub 私密漏洞报告](https://github.com/DeliciousBuding/xunji-mcp/security/advisories/new)。
说明受影响的版本和路径、最小合成复现以及影响。
报告中不要包含凭据、个人记录或私有部署信息。不要在公开 issue 中报告漏洞。

## 部署前提

一个部署只服务一名操作者的训记账号。所有获授权客户端读取该账号的数据，
包括共享的 D1 索引。缓存 subject 使用哈希并不意味着支持多租户。

公开提供实例访问前：

1. 为 `/authorize` 配置 Cloudflare Access，设置 `ACCESS_TEAM_DOMAIN`、
   `ACCESS_AUD`，并让 `ALLOWED_USER_EMAILS` 只包含操作者。
   Worker 会验证 JWT 签名、issuer、audience 和有效期。
   另一种方式是使用足够长的随机 `OWNER_PASSPHRASE`。
   两种方式都未配置时，授权会 fail closed。
2. 设置 `workers_dev: false`，关闭 `workers.dev` 路由。
   Access 策略按域名生效，其他路由可能绕过 Access 应用，
   但 Worker 自身仍会执行身份验证。
3. Access 正常工作后，移除已部署的 `OWNER_PASSPHRASE`。
   只要仍配置口令，它就能在任意可达域名上提供另一条授权路径。
   应急副本只保存在操作者的密码管理器中。
4. 除非需要真实写入，否则保持 `WRITE_TOOLS_ENABLED=false`。
   开启后，token 还须包含 `xunji:write`，每次调用都须传入 `confirmed: true`。
   桥从不发送 `dry_run`，也不提供删除操作。
5. 每个上游 Key 都存为 Worker secret。只有具备对应 Key 才启用可选数据域；
   这些域的真实上游核验仍待完成。
6. 检查健康状态、发现文档和授权拒绝行为。按需启用 `/admin/*`，
   它使用独立 `ADMIN_TOKEN`，覆盖信息可能暴露日期和计数。

## 禁止提交的密钥和私有配置

| 密钥或私有配置                                            | 存储方式                             |
| --------------------------------------------------------- | ------------------------------------ |
| `XUNJI_API_KEY`                                           | 训练及计划访问的 Worker secret       |
| `XUNJI_BODY_KEY`                                          | 身体测量的可选 Worker secret         |
| `XUNJI_FOOD_KEY`                                          | 饮食记录的可选 Worker secret         |
| `XUNJI_FOOD_SEARCH_KEY`                                   | 食品目录搜索的可选 Worker secret     |
| `OWNER_PASSPHRASE`                                        | 口令模式下的 Worker secret           |
| `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ALLOWED_USER_EMAILS` | 按用途放在私有部署 secret 或 vars 中 |
| `ADMIN_TOKEN`                                             | `/admin/*` 的可选 Worker secret      |
| Cloudflare API token                                      | 私有本地环境或 CI secret             |

`.gitignore` 排除 `wrangler.jsonc`、`.dev.vars`、`.env*` 和 `.local/`。
CI 扫描凭据模式。使用合成 fixture 和示例域名；
模式扫描不能代替对记录、截图和历史的人工检查。

Key 泄露后，应在训记中撤销或轮换，并替换对应 Worker secret，
同时撤销受影响的 OAuth grant。轮换不会清除索引历史或客户端副本，
存储清理方式见[隐私](PRIVACY.zh-CN.md)。
[验收记录](docs/acceptance.zh-CN.md)中的 Key 轮换仍需操作者确认。

## 配额隔离

Workers KV 免费额度由整个账户共享，写入额度是主要约束。
本项目不会为历史读取消耗这部分缓存写入额度：

- 扫描只写 D1，受每个 UTC 日的 `SCAN_DAILY_LIMIT` 限制，默认 100 天。
- KV 仅作为今天、昨天的热点训练缓存，受 `KV_WRITE_DAILY_BUDGET` 限制，
  默认每天 300 次写入。
- `/admin/*` 和 `xunji_history` 报告计数；超预算的缓存写入会跳过，
  并标记 `budgetDegraded`。

这些是单部署限制，并未预留账户级额度。
OAuth provider 的 KV 写入和其他 Worker 也会使用同一账户的额度。

## 访问和能力边界

`/mcp` 使用 OAuth provider，静态 admin token 不能代替 MCP grant。
`xunji:read` scope 包含索引回填和刷新控制，
它们会修改桥自身的存储，但对训记只执行读取。

身体、饮食和食品搜索适配器已经实现。注册工具需要在
`ENABLED_DATA_DOMAINS` 中加入对应的 `body` 或 `nutrition`，
并配置独立上游 secret。它们仍标记为 `verified: false`；
配好 Key 不等于完成真实兼容性核验。

个人模板修改和上游删除不在公开工具范围内。
可通过 `localid` upsert 或训记 App 纠正训练 session。
完整模型见[威胁模型（英文）](docs/threat-model.md)。
