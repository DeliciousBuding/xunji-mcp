# 可用性与验证

[English](coverage.md) · [简体中文](coverage.zh-CN.md)

本文描述通用工具范围与部署评估方法，不包含个人部署设置或历史回填完成声明。
可用性、源码所依赖的契约验证、索引覆盖和客户端兼容性需分别检查。

## 工具可用性

所有列出的 MCP 工具都要求 `xunji:read`。
训练工具还要求 `ENABLED_DATA_DOMAINS` 包含 `train`。
可选数据域要求相应域标记及对应独立 secret。

| 数据域或接口                   | 工具                                                                         | 注册或使用条件                                                                                     | 验证边界                                                |
| ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 能力说明                       | `xunji_capabilities`                                                         | read scope                                                                                         | 配置摘要，不是实时探测                                  |
| 单日训练                       | `xunji_get_training_day`                                                     | `train`；读取上游需要 `XUNJI_API_KEY`                                                              | 请求/响应封装契约已有观察；操作者自己的 Key 需单独验证  |
| 索引分组                       | `xunji_query_training`                                                       | `train` + D1 `DB`                                                                                  | 读取已有索引数据；完整范围覆盖需要扫描                  |
| 索引概览                       | `xunji_training_overview`                                                    | `train` + D1 `DB`                                                                                  | KPI 对应返回的范围和覆盖状态                            |
| 动作进展                       | `xunji_movement_progress`                                                    | `train` + D1 `DB`                                                                                  | 派生估计和平台期启发式，不是实测力量或医学评估          |
| 历史控制                       | `xunji_history`                                                              | `train` + D1 `DB` + `SCAN_COORDINATOR`；扫描需要训练 Key                                           | 接受请求表示已入队，不表示完成                          |
| 有界单日/范围统计              | `xunji_list_training_days`、`xunji_training_stats`、`xunji_movement_history` | `train`；上游读取需要训练 Key                                                                      | 部分结果返回 `pending` 与 `deferred`；不读取 D1         |
| 动作目录                       | `xunji_search_movements`                                                     | `train`；不需要上游训练 Key                                                                        | 公开目录契约；名称和大小可能变化                        |
| 官方计划                       | `xunji_list_plans`、`xunji_get_plan`                                         | `train`；上游读取需要训练 Key                                                                      | list/get 封装已有观察；有内容的逐日安排和计划比较未验证 |
| 身体测量                       | `xunji_body_query`                                                           | `body` + `XUNJI_BODY_KEY`                                                                          | 根据厂商 Skill 实现的适配器；未验证真实响应             |
| 饮食记录                       | `xunji_nutrition_query`                                                      | `nutrition` + `XUNJI_FOOD_KEY`                                                                     | 根据厂商 Skill 实现的适配器；未验证真实响应             |
| 食物搜索                       | `xunji_search_foods`                                                         | `nutrition` + `XUNJI_FOOD_SEARCH_KEY`                                                              | 根据厂商 Skill 实现的适配器；未验证真实响应             |
| 训练 upsert                    | `xunji_upsert_training_day`                                                  | `train` + `WRITE_TOOLS_ENABLED=true` + `xunji:write`；需要训练 Key；每次调用要求 `confirmed: true` | 真实写入，默认关闭；没有安全的上游预览或删除            |
| MCP Apps 概览                  | 资源 `ui://xunji/overview`                                                   | `train` + D1 + `MCP_UI_ENABLED=true` + read scope                                                  | 注册与宿主渲染需分别验证                                |
| 模板、计划写入、计划比较、删除 | 无工具                                                                       | 未实现                                                                                             | 不声明可用或完成                                        |

## 解释 `xunji_capabilities`

工具返回[能力矩阵](../src/capabilities.ts)中的行，包含
`domain`、`capability`、`endpoint`、`tool`、`scope`、`configured`、
`verified`、`status` 和可选备注。
状态值为 `ready`、`unconfigured`、`disabled`、`not_implemented`。

这些字段当前描述源码常量和环境绑定：

- `configured` 通常检查 Key/绑定是否存在，不检查凭据是否有效。
  写入行只检查启用标记。
- `verified` 是代码层标记。训练/目录/计划行使用常量；索引行检查绑定是否存在。
  它不发起请求，也不保存部署的真实验证结果。身体/饮食/写入行仍为 `false`。
- 矩阵不会对每一行应用 `ENABLED_DATA_DOMAINS` 或调用者 scope。
  矩阵中的索引行同时要求 D1 和扫描器，而查询工具注册只要求 D1。
- 因此，`ready` 行不能证明调用者能发现或执行该工具。
  用 OAuth `tools/list` 获取 token 对应的实际清单，再用只读调用验证凭据和响应。

公开 `/healthz` 返回配置标记、身份模式、版本和允许名单条目计数。
它不验证 secret、schema 迁移、上游账号或客户端连接。
`GET /admin/tools` 由 `ADMIN_TOKEN` 保护，使用只读的合成 admin 身份列出工具和资源；
不检查 write scope 下的工具发现。

## 索引覆盖

每个请求的日历日期都有扫描状态：

| 状态       | 含义                                                           |
| ---------- | -------------------------------------------------------------- |
| `complete` | 成功读取到训练，且索引替换已完成                               |
| `empty`    | 成功读取，没有训练                                             |
| `pending`  | 已排队或延后的工作；没有队列行的日期在覆盖统计中也计为 pending |
| `error`    | 读取或替换失败，并已设置重试时间                               |

只有每个请求日期都为 `complete` 或 `empty`，且没有错误日期时，
`coverage.complete` 才为 true。
它证明扫描覆盖，不证明获取了完整的 full 上游响应。
扫描使用 light 读取，上游截断没有单独的扫描状态。

应检查整个 `coverage`：范围、`days`、`scannedDays`、`emptyDays`、
`pendingDays`、`errorDays`、`latestScanned` 和 `lastRefresh`。
返回的 `pending` 和 `errors` 数组分别最多 60 和 20 项，计数可以更大。
`missingDays` 包含已排队和没有队列行的非终态日期。

`earliestRecord` 表示相关范围内最早的已索引训练，不能证明更早的账号历史。
字段名需谨慎解释：`coverage.earliestVerified` 是最早的终态扫描日期；
`xunji_history.history.earliestVerified` 当前保存从配置起点开始连续终态前缀的结束日期。
两者都不能代替针对具体范围的完整性检查。

回填被接受、队列非空或 `scanner.running: true` 都不能证明 alarm 正在执行。
running 标记和 ETA 根据暂停状态、队列计数和平均进度计算。
预算等待与重试可能改变完成时间。

## 新鲜度与当前实现限制

- 旧版两次读取预算只统计成功的未缓存结果。
  延后结果不消耗预算，因此它不会限制每一次上游请求尝试。
- 每日 cron 只填补最新终态扫描日期之后直到昨天的尾部范围。
  更早的源数据修改或缺口需用 `refresh`。
- 按需单日读取和 upsert 不更新 D1。
  upsert 可能刷新符合条件的 light KV 条目；full KV 条目与索引数据独立保留。
- 单日替换使用多个 D1 批次，再记录扫描状态，没有跨整日的事务。
  失败的刷新可能留下部分替换的数据，并显示覆盖不完整。
- KV 写入计数是缓存尝试预算，不包含 provider 的 OAuth 写入。
  缓存层虽记录降级标记，当前单日工具没有将它传入元数据。
- 索引容量使用记录中的数值重量和次数计算；单位为 kg，缺失单位按 kg 处理。
  `selfWeight` 单独计数，但不会覆盖明确的数值重量。
  最佳重量和 Epley 字段假设记录重量为 kg，不转换单位。
- 应选择范围 preset 或明确日期。滚动 preset 当前忽略明确的 `from`；
  自定义范围需省略 `preset`。
- 身体 `latest` 解析和可选数据域分页未经过真实响应验证。
  配置 Key 不能证明完整取回数据。

这些是已记录的行为限制，不表示已测试某次部署或已修复这些缺口。

## 避免发布账号数据的验证方式

仓库检查使用合成 fixture 和 stub 上游 HTTP。
发布条件维护在[验收说明](acceptance.zh-CN.md)中；通过这些检查不代表验证了另一个部署。

部署验证应检查 OAuth 发现和未认证请求的 challenge，完成操作者授权确认，
检查 `tools/list`，再进行只读调用。
索引分析需检查历史状态和确切请求范围的覆盖。
MCP Apps 需在选定宿主中单独确认资源关联和渲染。

域名、Key、邮箱、账号标识、日期和训练值应保留在操作者的私有记录中。
公开验证说明只写验证方法和未解决的能力限制。
另见[部署指南](deployment.zh-CN.md)、[ChatGPT 接入指南](chatgpt-connect.zh-CN.md)
和[上游契约说明](api-contract.zh-CN.md)。
