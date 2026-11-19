# 上游契约说明

[English](api-contract.md) · [简体中文](api-contract.zh-CN.md)

本文区分此前观察到的上游行为与根据厂商 Skill 实现的适配器请求。
只记录数据结构和失败形态，不记录账号数据或某次部署的验证结果。
示例仅使用占位符。

请求实现在[训练客户端](../src/upstream/client.ts)和[可选数据域适配器](../src/upstream/domains.ts)中。
工具的标准化输出属于桥的契约，不是上游的完整 schema。

## 共用响应处理

请求使用 JSON POST。需要认证的端点通过
`Authorization: Bearer <domain-key>` 接收 Worker secret。
动作目录请求不带认证。客户端请求 gzip；如果运行时尚未解压，会检测 gzip 魔数并处理。

成功响应将对象或数组放在 `res` 中。`success` 可能不存在，因此客户端不会只凭这个标记
判断成功。此前观察到的训练失败形态包括：

```json
{ "success": false, "res": "too frequent, retry after 30s" }
```

```json
{ "success": false, "res": "apikey invalid" }
```

```json
{ "success": false, "error": "datestr invalid" }
```

这些应用层失败可能使用 HTTP 200。
客户端对字符串 `res`、直接返回的字符串，以及对象形式的 `error.message` 分类。
只有字符串 `error`、没有可用 `res` 的响应当前会映射为 `bad_payload`，
不会标准化成 `invalid_request`。

HTTP 401/403 映射为 `unauthorized`；其他非成功 HTTP 状态映射为 `upstream_unavailable`。
未知厂商文本会替换成通用消息。匹配 `retry after Ns` 的重试提示会变为 `retryAfterSeconds`。

默认 fetch 超时为 15 秒，可通过 `UPSTREAM_TIMEOUT_MS` 配置，接受的最小值为 1000 ms。
计时器只覆盖 fetch 等待响应头的过程。响应体读取和解压没有独立计时器。
客户端在自行解压之前，对已经完整读取的响应缓冲区检查 2 MiB 限制；
它既不是流式大小限制，也不是针对解压后数据的独立限制。

## 读取一个训练日

```text
POST https://trains.xunjiapp.cn/api_trains_for_llm_v2
Authorization: Bearer <training-key>
Content-Type: application/json

{"schema_version":"train_open_api_v2","datestr":"YYYY-MM-DD","include_full_data":false}
```

可用数据位于 `res`，可包含 schema/version 字段、`datestr`、`limits`、`truncated` 和 `trains`。
一次训练包含 `localid`、日期、可选标题/时间戳与动作。
动作包含名称、可选分类/休息字段和组。组的重量与次数可能是字符串。
不为未知字段编造 schema。

`trains` 为空数组表示成功读取了一个没有训练记录的日期。
`limits` 包含厂商限制，例如 light/full 读取间隔和写入限制。
已观察到的训练限制包括每天四次训练、每次写入最多 15 个动作、每个动作最多 20 组。

light 读取间隔为 15 秒。`include_full_data: true` 使用 30 秒间隔，
可能增加未勾选组、RPE、备注/评论、左侧重量和心率数据。
桥返回选择后的标准化表示，不会返回全部字段或压缩的心率载荷。

API 使用日历日期字符串，没有时区参数。桥保留日期，并在 `Asia/Shanghai` 中计算默认值。

## 动作目录

```text
POST https://trains.xunjiapp.cn/api_movement_catalog_for_llm_v2
Content-Type: application/json

{}
```

已观察到的响应是包含 schema/version 元数据和 `movements` 的 `res` 对象。
条目包含规范名称，也可能包含 `type`、`exetype` 和别名。
该端点曾在没有有效训练 Key 时返回结果；桥明确不发送 Authorization 头。

目录大小不是稳定契约。MCP 搜索对名称和别名做子字符串匹配，
缓存预算允许时，将公开目录缓存七天。

## 官方计划

```text
POST https://api.xunjiapp.cn/open/plan/query_gzip
Authorization: Bearer <training-key>
Content-Type: application/json

{"schema_version":"plan_open_api_v1","action":"list"}
```

```text
{"schema_version":"plan_open_api_v1","action":"get","plan_ref":"<plan-ref-from-list>",
 "start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","include_movements":true}
```

此前观察到的响应使用 `{"success":true,"res":{...}}`，并可能经过 gzip 压缩。
list 结果读取 `plans`；get 结果读取 `plan`、`days` 和 `date_range`。
桥不对这些嵌套计划值声明完整 schema。

MCP get 工具默认读取过去七天至未来 30 天，并限制为 1–92 天。
这些是桥的默认值和边界。有内容的逐日计划契约尚未验证；
空 `days` 不能证明已支持计划比较。

## 训练 upsert

```text
POST https://trains.xunjiapp.cn/api_upsert_trains_for_llm_v2
Authorization: Bearer <training-key>
Content-Type: application/json

{"schema_version":"train_open_api_v2","client_request_id":"<request-id>",
 "res":[<session-object>]}
```

以上是请求结构占位符，不是可执行的写入示例。

- 提供训练 `localid` 时更新该次训练；省略时创建。
- 桥每次写工具调用只发送一次训练，包含 1–15 个动作，每个动作 1–20 组。
- `client_request_id` 传给上游。桥没有本地幂等记录，也没有确认厂商的重试保证。
- 厂商忽略 `dry_run`。必须将该端点的每个请求视为真实写入；桥不会序列化这个标记。
- 没有已文档化、且由本桥实现的上游删除操作。

工具默认关闭，要求启用训练、具备 read 和 write scope、
`WRITE_TOOLS_ENABLED=true` 与 `confirmed: true`。
日期检查将解析后的日期与当前时刻比较，采用 190 天边界；
向客户端描述为约六个月。
输入契约与索引刷新行为见[工具说明](tools.zh-CN.md)。

## 可选适配器请求：未经过真实响应验证

身体和饮食使用独立 Key。训练 Key 被这些域拒绝，不能验证其成功响应。
下表描述当前适配器代码根据厂商 Skill 实现的请求，不将其视为已观察到的真实契约。

| 适配器   | 端点                                                       | Secret                  | JSON 请求字段                                                                                  |
| -------- | ---------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| 身体测量 | `POST https://api.xunjiapp.cn/open/body/query_gzip`        | `XUNJI_BODY_KEY`        | `start_date`、`end_date`、可选 `types`、`include_latest`、`include_records`、`limit`、`offset` |
| 饮食记录 | `POST https://eatings.xunjiapp.cn/open/food/query_gzip`    | `XUNJI_FOOD_KEY`        | `start_date`、`end_date`、`include_detail`                                                     |
| 食物搜索 | `POST https://api.xunjiapp.cn/open_agent/food/search_gzip` | `XUNJI_FOOD_SEARCH_KEY` | `keyword`、`limit`                                                                             |

身体标准化接受 `records`，并尝试返回 `latest`。
饮食记录标准化接受名为 `records`、`foods` 或 `data` 的数组；三者都没有时拒绝响应。
食物搜索接受 `foods` 或列式 `d` 数组。
这些是当前解析方式，不能证明分页完整、最新值准确或真实接口兼容。

工具只有在配置对应 secret，且 `ENABLED_DATA_DOMAINS` 包含 `body` 或 `nutrition` 时注册。
输出仍为 `verified: false`，没有写入操作。

## 来源与验证

- 训记厂商分发的训练、计划、身体、饮食和模板 Agent Skills。
- 公开规范动作名称：<https://github.com/Foveluy/Xunji-movements>。
- 桥的源码及以上限制说明。

模板和计划修改不在已实现的工具范围中。
部署验证应记录在操作者的私有记录里；
公开[覆盖说明](coverage.zh-CN.md)介绍如何验证，同时避免发布训练值或部署标识。
