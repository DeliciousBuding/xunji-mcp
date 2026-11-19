# ADR 0003：上游契约、限频与写入安全

[English](0003-upstream-contract-and-write-safety.md) · [简体中文](0003-upstream-contract-and-write-safety.zh-CN.md)

- 状态：已接受
- 日期：2026-11-19

## 背景

训记 Open API 的文档由厂商 Agent Skill 和公开 `Xunji-movements` 仓库提供。
已观察到的行为与常规 REST API 有一些差异，需要集中处理。

此前观察到的上游行为，不包含账号值：

| 行为           | 观察                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| 成功封装       | `{ res: {...} }`；读取中没有 `success`                                                            |
| 失败封装       | HTTP 200，内容为 `{ success: false, res: "too frequent, retry after 30s" }` 或 `"apikey invalid"` |
| 压缩           | 大响应在传输层使用 gzip，小响应是普通内容                                                         |
| 限频           | 相同 Key + 相同日期：light 15 秒，`include_full_data` 30 秒；不同日期独立                         |
| 限制块         | 每次训练读取返回 `limits.readRateLimitSecondsLight/Full`；写入间隔 45 秒                          |
| 写入 `dry_run` | 被忽略；带该标记的请求仍可能写入                                                                  |
| 删除           | 没有文档化或观察到的端点                                                                          |
| 目录           | `POST /api_movement_catalog_for_llm_v2`，请求 `{}`；没有有效 Key 时也返回过结果                   |
| 计划           | `api.xunjiapp.cn` 上的 `POST /open/plan/query_gzip`，使用相同 Key，支持 `list` 和 `get`           |
| 其他数据域     | 身体和饮食端点要求独立 Key；训练 Key 被拒绝，返回 `apikey invalid`                                |

## 决定

1. 将写端点视为始终真实执行。
   仅在启用训练、read scope、`WRITE_TOOLS_ENABLED=true` 和 write scope 时注册工具。
   要求 `confirmed: true` 和实现中的 190 天日期保护。
   agent 必须在调用前展示确切修改供用户确认，不提供 `dry_run` 字段或删除工具。
2. 在 `src/upstream/client.ts` 集中处理封装、压缩和类型化失败。
   `src/domain/normalize.ts` 标准化训练输出，
   D1 数据和查询指标使用索引/指标模块。
   所选计划值不声明完整 schema。
3. 索引查询选择已完成组，默认排除热身，不将单侧重量翻倍，
   Epley 估计限定为 1–12 次。
   当前计算使用记录中的数值重量：`selfWeight` 不覆盖明确的负荷。
   旧版标准化对热身/次数有不同处理，限制见[工具](../tools.zh-CN.md)。
4. 使用 `(subjectHash, date, mode)` 对应的 Durable Object 预约读取。
   超出有界等待时返回 `deferred`，厂商应用层限频保存为冷却状态。
   这些条目不是同一上游 Key 所有调用者共用的全局 gate。
5. 按 subject 和模式缓存解包后的厂商单日响应：今天五分钟，昨天两分钟。
   其他日期不写单日缓存，动作目录缓存七天。
   所有缓存 put 都使用 D1 预算，扫描完全跳过 KV。
6. 旧版范围保持 31/62 天上限，每次最多预算两次成功未缓存读取，
   返回 `pending`/`deferred`。
   历史调用没有持久游标；应缩小至 pending 范围或使用索引查询。
7. 历史使用 D1 和可恢复扫描协调器。
   查询报告 `complete`/`empty`/`pending`/`error` 覆盖。
   刷新分批替换源数据后记录扫描状态，整日操作不是原子的。
   cron 填补截至昨天的未覆盖尾部，不重新检查旧修改。
8. 可选身体/饮食工具要求独立 secrets 并启用数据域。
   适配器根据厂商 Skill 实现，保持 `verified: false`；
   不从配置推断真实成功响应或完整取回。

## 影响

- 旧版范围可以不完整。
  重复相同历史范围不会通过 KV 累积覆盖；历史数据通过索引回填获取。
- 桥不能声称“已删除”；文档和工具描述都明确这一点。
- 写适配器已存在，但默认关闭。
  非空响应可能替换符合条件的 light 缓存条目，
  不更新 D1，也不会使 full 条目失效。
  应回读修改，并单独刷新派生数据。
- 训练 `noteText` 可选；动作/组备注和已解析卡路里/颜色仍可能出现。
  客户端必须把全部返回文本当作数据。
- 仓库检查必须使用合成 fixture 和 stub 上游 HTTP。
  真实验证是操作者单独进行的活动，应放在私有记录中；
  启用写入不是验证捷径。
- `coverage.complete` 证明终态扫描覆盖，不证明完整、未截断的 full 上游响应。
  替换失败可能留下部分数据。

当前验证边界见[上游契约](../api-contract.zh-CN.md)、
[覆盖说明](../coverage.zh-CN.md)和[威胁模型](../threat-model.zh-CN.md)。
