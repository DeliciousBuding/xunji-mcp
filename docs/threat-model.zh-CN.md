# 威胁模型

[English](threat-model.md) · [简体中文](threat-model.zh-CN.md)

范围是一个自托管、单操作者的桥，连接 MCP 客户端（ChatGPT、Claude、Cursor 等）
和一个训记账号。部署通过公开 HTTPS origin 供托管 MCP 客户端访问。

## 资产

| 资产                       | 存储位置                                             | 泄露影响                                |
| -------------------------- | ---------------------------------------------------- | --------------------------------------- |
| 训记数据域 Key             | Worker secrets：`XUNJI_API_KEY` 及可选独立数据域 Key | 上游操作者数据访问权限，包括训练写入    |
| 训练历史                   | 训记服务器；D1 派生数据和热 KV 缓存中的解包响应      | 可推断个人健康和习惯                    |
| OAuth 授权 / refresh token | provider KV（`OAUTH_KV`）                            | 在撤销前访问桥                          |
| 操作者身份                 | Access JWT / 口令、token props                       | 在授权确认阶段冒充操作者                |
| 部署配置                   | Git 忽略的 `wrangler.jsonc`、secrets                 | 可用性故障或错误 origin 的 OAuth 元数据 |
| 操作者控制接口             | `ADMIN_TOKEN` 保护的 `/admin/*`                      | 索引/回填控制、覆盖元数据和工具清单     |

## 信任边界

1. **客户端 → Worker。**
   OAuth 参数、MCP JSON-RPC、bearer token 和请求头都是不可信输入。
   provider 验证 token，handler 用 Zod 验证工具参数，上游 Key 在服务器端添加。
2. **Worker → 训记。**
   出站请求使用服务器端数据域 Key。
   响应缓冲区在客户端自行 gzip 解压前检查；数据解析后映射到工具输出。
3. **浏览器 → `/authorize`。**
   provider 提供绑定浏览器、单次使用的 consent handle 防止 CSRF；
   身份来自 Access 或口令。
4. **操作者 → 部署。**
   secrets 通过 `wrangler secret put` 设置；
   公开仓库不包含真实 origin、账号或凭据。
5. **Worker → MCP Apps 宿主。**
   可选概览视图通过父窗口消息接收相同结构化结果。
   宿主提供沙箱，视图只格式化数据，不发起网络请求或存储。

## 威胁与控制

| 编号 | 威胁                                                | 控制                                                                                                                                          |
| ---- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | 陌生人用自行注册的客户端完成 OAuth 并读取操作者数据 | 授权要求操作者身份：通过 JWKS 验证 Access JWT 并匹配邮箱允许名单，或验证部署口令。注册本身不授予权限                                          |
| T2   | bearer token 被窃取或伪造                           | 不透明随机 token 以哈希存储；audience 匹配规范资源；access TTL 一小时；refresh 轮换和空闲过期；支持撤销端点                                   |
| T3   | redirect URI 劫持或开放重定向                       | provider 精确匹配注册的 redirect URI，要求 HTTPS 或 loopback，无 fragment/userinfo，并在授权和 token 阶段验证 `resource`                      |
| T4   | 授权确认 CSRF                                       | `beginConsent()` 签发绑定浏览器、单次使用的 handle；无绑定 cookie 的 POST 被拒绝。客户端和 redirect URI 未验证前不将错误重定向                |
| T5   | 客户端元数据导致授权页 XSS                          | 所有客户端字符串都做 HTML 转义；CSP 使用 `default-src 'none'`、`frame-ancestors 'none'`，并设置 `X-Frame-Options: DENY`；没有客户端 JS        |
| T6   | CIMD `client_id` URL 导致 SSRF                      | provider 的 CIMD 请求使用 `global_fetch_strictly_public`，仅 HTTPS，并有大小和时间限制                                                        |
| T7   | 跨用户泄露                                          | KV 键包含经验证身份派生的 SHA-256 subject 前缀；D1 明确按部署对应一个训记账号；没有接受用户标识的端点                                         |
| T8   | 意外破坏性写入                                      | 要求启用 `train`、read scope、`WRITE_TOOLS_ENABLED=true` 和 write scope；必须有字面量 `confirmed: true`；190 天日期保护；没有删除或 `dry_run` |
| T9   | 消耗厂商限频额度或自我拒绝服务                      | 按 subject/日期/模式进行 Durable Object 预约、有界等待和冷却；范围预算为两次成功未缓存读取；可恢复扫描默认每个 UTC 日 100 次尝试              |
| T10  | 日志或错误泄露 Key                                  | 上游客户端不记录请求；未知厂商错误转换为通用错误码/消息。当前 Worker 日志包含工具清单名称/计数和授权失败的名称/消息                           |
| T11  | 训练备注中的提示词注入                              | 训练备注文本可选，但动作/组备注仍可能出现。返回文本是数据，没有工具执行它；客户端必须保持这个边界                                             |
| T12  | 资源耗尽                                            | MCP 请求体限制 32 KiB；已读取缓冲区检查 2 MiB；fetch 等待响应头默认超时 15 秒；训练查询和写入载荷有边界；缓存预算默认 300 次尝试              |
| T13  | 撤销后重放 token                                    | provider 在 `deleteClient` 时撤销客户端 token；access token 最多一小时；refresh 空闲过期 30 天                                                |
| T14  | admin 端点滥用或 token 泄露                         | secret 以 SHA-256 摘要和恒定时间循环比较；响应只暴露索引元数据/控制和工具/资源清单，不返回训练载荷。未配置 token 返回 404；凭据无效返回 401   |
| T15  | 耗尽全账号 KV 配额                                  | 扫描跳过 KV；缓存写入使用 D1 计数器，超出配置的 UTC 日预算或失败时跳过。provider 的 OAuth 写入不在缓存预算内                                  |

## 范围外

- 训记厂商本身被攻破。
- 操作者明确授权的恶意 MCP 客户端：它可以读取已授予的数据。
- 多租户 Key 托管。一个部署服务一个训记账号，可选数据域使用独立 Key。
- 默认部署的写入：已关闭。
- 身体/饮食真实响应验证；适配器要求独立 Key 和启用数据域。

## 剩余风险

- 口令可能被钓鱼或复用。推荐 Access；
  Access 可用后移除 `OWNER_PASSPHRASE`，
  因为它是可从任何到达 Worker 的主机名使用的另一把钥匙。
- `workers.dev` 等备用主机名可能绕过按主机名配置的 Access 策略。
  禁用未使用路由。没有配置口令时，Worker 仍要求有效、匹配允许名单的 Access JWT 才授予权限。
- 宿主被攻破会暴露 Worker secret。怀疑发生此情况时，在训记 App 中轮换 Key。
- D1 在操作者清除前保留索引范围内的派生数据，属于单账号敏感信息。
  `CACHE_KV` 将今天/昨天的响应保留几分钟，并缓存公开动作目录；
  `OAUTH_KV` 单独保存 OAuth 状态。
  即使工具省略训练备注文本，热条目仍可能包含 full 模式备注。
  Cloudflare 账号属于信任边界的一部分。
- 厂商没有删除 API；误写需在训记 App 中纠正，或通过后续 upsert 覆盖。
- D1 替换和扫描状态跨多个批次，刷新失败可能留下部分数据。
  单日读取和写入不更新 D1；写入不使 full 热缓存失效。
- 读取 gate 按 subject/日期/模式隔离，不按上游 Key 全局隔离。
  admin/cron 扫描与 OAuth 读取可能为同一账号使用不同 subject；
  独立条目不能保证全局读取间隔。
- fetch 计时器在响应头到达时结束。
  响应体读取/解压没有独立超时或解压后大小限制。
  可选数据域范围不采用旧版训练范围上限。
- 当前授权失败日志包含 provider 错误消息。
  不要向日志增加请求体、凭据、身份细节或厂商载荷；
  部署时检查平台日志配置。
- 能力 `verified`/`ready` 标记不能证明真实凭据有效、索引覆盖完整或客户端能够渲染。

状态存储和读取路径见[架构](architecture.zh-CN.md)，
验证语义见[覆盖说明](coverage.zh-CN.md)，
操作者身份配置见[部署](deployment.zh-CN.md)。
