# 验收条件与核验状态

[English](acceptance.md) | [简体中文](acceptance.zh-CN.md)

本页保留已有 Release 文档中的历史核验记录。本次文档更新没有运行测试、
基准、部署或真实客户端检查。公开文档省略个人记录、聚合统计、
日期范围和部署标识。

状态说明：**PASS** 表示在所列范围内曾通过核验；**PARTIAL** 表示已有实现或
mock 覆盖，但真实核验不完整；**BLOCKED** 表示需要操作者或客户端处理；
**N/A** 表示不属于对应版本的范围。历史 PASS 不能证明当前部署或所有客户端均通过。

| #   | 条件                                                       | 历史核验范围                                                                        | 状态               |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| A1  | 使用操作者 Key 读取训练日                                  | 既有私有上游读取；省略内容                                                          | PASS               |
| A2  | 处理 gzip 和普通上游响应体                                 | Fixture 测试及既有两种响应形式的观察记录                                            | PASS               |
| A3  | 将空训练日视为成功                                         | 既有空日 stub 集成测试                                                              | PASS               |
| A4  | 将 `too frequent, retry after Ns` 映射为有类型的可重试结果 | 既有模拟上游回复的集成测试                                                          | PASS               |
| A5  | 执行按日读取节奏和冷却                                     | 既有 Durable Object 测试及私有完整读取限频观察                                      | PASS               |
| A6  | 限制范围读取并显式返回 `pending`                           | 已有范围上限测试；未执行完整跨度的真实部分读取                                      | PARTIAL            |
| A7  | 发布 OAuth 发现文档                                        | 既有 PRM、AS metadata、S256 和 `iss` 集成测试                                       | PASS               |
| A8  | 完成 PKCE 授权码流程                                       | 既有 register → authorize → token → `tools/list` 集成测试                           | PASS               |
| A9  | 错误口令不创建 grant                                       | 既有集成测试                                                                        | PASS               |
| A10 | 拒绝未注册的 redirect URI                                  | 既有集成测试                                                                        | PASS               |
| A11 | 未授权 `/mcp` 返回 401 和 `resource_metadata` challenge    | 既有集成测试                                                                        | PASS               |
| A12 | 默认不注册写工具                                           | 既有集成和单元测试                                                                  | PASS               |
| A13 | 写路径从不发送 `dry_run`                                   | 既有序列化请求体单元测试                                                            | PASS               |
| A14 | 拒绝超日期窗口或缺少确认的写入                             | 既有单元测试                                                                        | PASS               |
| A15 | 记录公开发布的凭据模式检查                                 | 既有扫描、人工和历史检查；不能证明不存在所有形式的个人数据                          | PASS               |
| A16 | 本地运行 typecheck、测试并提供 CI workflow                 | 既有 `npm run typecheck && npm test`；workflow 已提交，不笼统声称 CI 或 lint 已运行 | PASS (local)       |
| A17 | 部署使用 TLS 的 Worker                                     | 既有私有部署和生产 smoke 检查                                                       | PASS               |
| A18 | 完成 ChatGPT OAuth 并列出工具                              | 既有 Access 登录、同意授权、CIMD 及 OAuth 授权的 `tools/list`                       | PASS               |
| A19 | 通过 ChatGPT 读取训练数据                                  | 既有客户端读取与独立读取一致；省略内容                                              | PASS               |
| A20 | 验证 Access 模式身份                                       | 既有 `/authorize` 的私有 JWT、JWKS 和邮箱 allowlist 检查                            | PASS               |
| A21 | 确认上游 Key 已轮换                                        | 仍需操作者在训记中执行并确认                                                        | BLOCKED (operator) |
| A22 | 身体、饮食及食品搜索数据域                                 | 适配器采用上游 skill 契约及独立 Key；已有 mock 覆盖，未进行真实上游核验             | PARTIAL            |
| A23 | 历史读取和扫描不写 KV                                      | 既有扫描集成测试及私有刷新检查                                                      | PASS               |
| A24 | 扫描工作受每日预算限制                                     | 既有回填及公开的 UTC 日预算计数接口                                                 | PASS               |
| A25 | 热点 KV 缓存写入受部署预算限制                             | 既有超预算跳过行为及 `budgetDegraded`                                               | PASS               |
| A26 | 索引覆盖配置的历史窗口                                     | 既有私有回填曾报告配置窗口覆盖完整；省略日期和计数                                  | PASS               |
| A27 | 一次工具调用返回索引概览                                   | 既有合成基准产物；测量和限制见[基准](benchmark.zh-CN.md)                            | PASS               |
| A28 | 刷新后反映上游编辑或移除                                   | 既有集成测试在上游记录被移除后替换索引日                                            | PASS               |
| A29 | 区分空日、未扫描、待处理和错误覆盖                         | 既有 pending、error、partial 集成测试及历史状态                                     | PASS               |
| A30 | 处理热身、自重、单侧训练和时长异常                         | 既有排除规则、计数和异常标志集成测试                                                | PASS               |
| A31 | 通过 ChatGPT 调用 v0.2 查询工具                            | 既有 OAuth 授权的 `xunji_training_overview all_time` 返回索引结果；省略内容         | PASS               |
| A32 | 移除 `workers.dev` 备用入口                                | 既有私有路由检查显示备用入口不可用，Access 仍保护 `/authorize`                      | PASS               |
| A33 | Access 正常后移除部署口令回退                              | 既有私有 secret 列表及授权检查                                                      | PASS               |
| A34 | 无客户端访问时刷新索引末尾                                 | 既有 `enqueueDailyGap` 测试及定时触发器部署；本页不保留部署 ID                      | PASS               |
| A35 | 仅在开启时注册 MCP Apps 视图                               | 既有启用及关闭状态的资源和 metadata 测试，以及操作者工具列表检查                    | PASS               |
| A36 | 在 ChatGPT 中渲染 MCP Apps 视图                            | 既有记录仍待真实客户端渲染确认；注册资源不足以证明渲染成功                          | BLOCKED (client)   |

训练写入始终是真实写入，需要部署开启、`xunji:write` 和 `confirmed: true`。
桥不发送 `dry_run`，也不提供删除工具。真实只读检查不能验证真实写入。

可选适配器仍为 `verified: false`。配置完成或 mock 覆盖不能表述为真实核验。
Key 轮换和 ChatGPT MCP Apps 渲染分别保留为操作者及客户端侧待处理事项。

## 一个 Release 的完成条件

以下清单描述发布工作，不代表本次文档更新执行过这些检查。

1. 运行适用的 typecheck、lint、格式和 workerd 测试；上游使用 stub，
   汇报准确的命令和结果。
2. 运行 `node scripts/secret-scan.mjs --history`，并检查公开文件、fixture、
   截图和历史中是否存在凭据模式之外的个人数据。
3. 同步受影响的英文和中文文档，Release 文案描述对应 tag 的源码。
4. 获授权的部署须检查 `/healthz`、canonical OAuth 发现信息和未授权
   `/mcp` challenge；公开报告不包含私有标识。
5. 记录该部署和客户端的真实连接及读取，或明确标为待确认。
   若声称支持 UI，须单独验证真实客户端渲染，不能用资源注册代替。
6. 在确认完成前，保留操作者 Key 轮换和未核验可选数据域的状态。

既有私有部署检查不能证明任何特定托管工作区的兼容性。
每位操作者需要为自己的部署重复相关连接检查。
持久存储和清理方式见[隐私](../PRIVACY.zh-CN.md)。
