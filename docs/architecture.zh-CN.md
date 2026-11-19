# 架构与兼容性

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

xunji-mcp 以一个 Cloudflare Worker 服务一位操作者的训记账号。
训记是权威数据源。D1 保存可重建的分析索引；KV 保存 OAuth 状态和少量读取缓存。
部署身份与密钥放在私有配置和 Worker secrets 中。

## 组件

```text
MCP 客户端
  ├─ OAuth 发现 / 注册 / token 交换
  │    └─ @cloudflare/workers-oauth-provider
  │         └─ /authorize：Access 身份或部署口令，再确认授权
  └─ POST /mcp：MCP SDK Streamable HTTP，无状态 JSON 响应
       ├─ 索引查询 → D1
       ├─ 单日读取 → 热 KV 缓存 → UpstreamGate → 训记训练 API
       ├─ 历史控制 → D1 scan_day → ScanCoordinator alarm
       │                                      └─ UpstreamGate → 训记
       ├─ 动作目录 / 计划 → 训记
       └─ 可选身体 / 饮食适配器 → 独立的训记 Key

定时触发器 → 将未覆盖的尾部日期入队 → ScanCoordinator
/healthz   → 版本、身份验证模式、配置标记和计数
/admin/*   → ADMIN_TOKEN 保护的索引控制和工具清单
可选 MCP Apps 资源：ui://xunji/overview
```

| 状态存储          | 内容                                                              | 隔离与有效期                                   |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `OAUTH_KV`        | provider 管理的客户端、授权和 token                               | 采用 OAuth 有效期；不包含上游 Key              |
| `CACHE_KV`        | 今天/昨天解包后的训练响应，以及公开动作目录                       | 单日条目包含 subject 哈希与响应模式            |
| D1 `DB`           | `session`、`movement`、`set_fact`、`scan_day`、元数据和预算计数器 | 一个数据库对应一个账号；没有 subject 列        |
| `UpstreamGate`    | 预约与冷却时间戳                                                  | 按 subject 哈希、日期和 light/full 模式区分    |
| `ScanCoordinator` | 扫描 subject、模式、进度和 alarm                                  | 整个部署共用一个协调器；队列和暂停状态在 D1 中 |

D1 和扫描协调器是可选绑定。不配置 D1 时，有界的按需读取仍可使用；
但依赖 D1 的缓存写入预算不可用，因此跳过新 KV 缓存条目的写入。

## 单日读取流程

1. OAuth provider 验证 bearer token 及其资源绑定。
   Worker 从 `ctx.props` 获取 `{ subject, label, scope }`。
2. 工具用 Zod 验证参数，再调用 `readDay`。
3. 未要求 `refresh: true` 时，优先返回有效的热 KV 条目。
4. 缓存未命中时，向 `UpstreamGate` 预约读取：light 间隔 15 秒，full 间隔 30 秒。
   有界等待或已有冷却状态可能产生 `deferred`，并附带 `retryAfterSeconds`。
5. 上游客户端发送 JSON POST，处理 gzip，解包 `{ res }`，并将失败映射为稳定错误码。
6. 符合条件的响应在标准化之前写入缓存。工具标准化响应后返回训练数据和元数据。

“今天”按 `Asia/Shanghai` 计算。今天的缓存 TTL 为五分钟，昨天为两分钟；
其他日期不写入单日缓存。动作目录 TTL 为七天。
KV 缓存写入共用 D1 计数器，默认预算为每个 UTC 日 300 次尝试；
跳过或失败的缓存写入不会使成功的上游读取变成错误。

按需单日读取不查询或更新 D1。重复相同历史范围不会推进游标：
应根据返回的 `pending` 日期缩小下一次请求，或改用索引工具。

## 索引查询流程

1. 工具参数选择有界的过滤条件、指标和分组枚举。
2. 查询层解析日期范围，使用固定表达式和绑定的过滤值构造 SQL。
   客户端不能提供 SQL。
3. SQLite 聚合已完成的 `set_fact` 行，单独获取训练时长。
4. 结果包含 `columns`、`rows`、`totals`、单位、指标定义，以及来自 `scan_day` 的覆盖状态。
5. 分析工具返回简短文本摘要，数据放在 `structuredContent` 中。
   旧版单日工具在两个结果字段中都序列化相同 JSON。

`all_time` 依次使用已保存的 `history_start`、最早的终态扫描日期和回退范围。
它描述索引覆盖的范围，不能据此认定已发现账号历史的起点。
解释空结果或部分结果前，请阅读[覆盖说明](coverage.zh-CN.md)。

## 回填与刷新

`xunji_history` 将日期入队并启动 alarm；上游读取在工具调用之外执行。
每次 alarm 在 20 秒循环预算内，以并发三最多处理九个到期日期。
扫描使用 light 响应，并禁用 KV 读取和写入。
成功读取会替换索引中的数据；延后读取和错误会持久化重试时间。
暂停状态与队列可跨请求和重启保留。

默认扫描预算为每个 UTC 日尝试 100 个日期。预算耗尽时，协调器将下一次 alarm
安排在 UTC 午夜后不久。这些限制约束工作量，不承诺上游完成时间。

替换先清除旧日期的数据，再以每批 80 条语句插入新数据，最后记录 `complete` 或 `empty`。
整日数据与扫描状态不在同一个事务中。刷新期间或某一批失败后，必须检查覆盖状态。

示例 cron 为 `10 16 * * *`，即 `Asia/Shanghai` 的 00:10。
它需要历史起点，并将最新 `complete`/`empty` 日期之后直到昨天的尾部范围入队。
它不会重新检查更早的修改或缺口；这些日期需用 `refresh`。
自动扫描排除今天；手动历史请求可以指定自己的结束日期。

## 写入

写工具默认不注册。注册要求启用 `train` 域、拥有 `xunji:read`、
设置 `WRITE_TOOLS_ENABLED=true`，并拥有 `xunji:write`。
调用还必须提供 `confirmed: true`，且已配置上游 Key。

一次 upsert 创建或更新一次训练。返回非空训练响应时，可能替换符合条件的 light
单日缓存条目；它不会更新 D1，也不会使 full 缓存失效。修改后需单独刷新索引。
每次调用都是真实写入：不发送 `dry_run`，也没有删除工具。

## 兼容性

| 接口或协议                           | 实现                                                                              | 验证边界                                                |
| ------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| MCP Streamable HTTP                  | 无状态 JSON 响应；仅 `POST /mcp`；请求体限制 32 KiB                               | 没有旧版 SSE 端点或持久 MCP 会话                        |
| OAuth 授权码 + PKCE                  | 由 provider 管理；公共客户端必须使用 S256                                         | 桥负责操作者身份与授权确认                              |
| Client ID Metadata Documents（CIMD） | 已启用；provider 验证客户端元数据                                                 | 需要 `global_fetch_strictly_public`                     |
| Dynamic Client Registration（DCR）   | `/oauth/register`                                                                 | 注册不授予数据访问权限                                  |
| 预注册客户端                         | provider 的 `createClient()` helper                                               | 应用没有暴露这个 helper 的端点                          |
| RFC 9728 资源元数据                  | 默认路径对应 `/.well-known/oauth-protected-resource/mcp`                          | 规范资源为 `PUBLIC_ORIGIN + MCP_RESOURCE_PATH`          |
| RFC 8414 / RFC 9207 / RFC 8707       | 授权元数据、provider 重定向中的 `iss`、资源绑定                                   | 无效授权请求可能在本地显示错误                          |
| token 刷新与撤销                     | 轮换；access token 一小时；refresh 空闲有效期 30 天；`/oauth/token` 支持 RFC 7009 | 由 OAuth 库提供                                         |
| `offline_access`                     | provider 元数据中有广告                                                           | 当前授权页会从授予的 scope 中过滤它                     |
| ChatGPT 和其他 MCP 客户端            | 基于标准的连接流程                                                                | 每个客户端/工作区都需重复 OAuth、工具发现和只读调用验证 |
| MCP Apps 概览                        | 与概览工具关联的可选 HTML 资源                                                    | 宿主渲染需独立于工具执行验证                            |

## 可选数据域与展示

身体、饮食和食物搜索适配器已经存在，但仅在配置对应独立 Key 并启用数据域时注册。
它们的真实响应契约仍未验证。训练 Key 不会解锁这些数据域。

配置 D1、启用 `train`、拥有 read scope 并设置 `MCP_UI_ENABLED=true` 时，
服务器将 `ui://xunji/overview` 注册为 `text/html;profile=mcp-app`。
当前标签使用简体中文。视图通过宿主消息，使用已有结构化结果显示概览 KPI 和月度容量。
它不发起网络请求、不持久化数据，也不调用工具。
不支持该视图的宿主仍可使用文本和结构化结果。

模板管理、计划写入、计划与已记录训练日的比较，以及上游删除均未实现。
另见[工具](tools.zh-CN.md)、[上游契约](api-contract.zh-CN.md)、
[威胁模型](threat-model.zh-CN.md)和[部署指南](deployment.zh-CN.md)。
