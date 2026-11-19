# ChatGPT 接入

[English](chatgpt-connect.md) · [简体中文](chatgpt-connect.zh-CN.md)

ChatGPT 自定义连接器使用 MCP 授权契约：受保护资源元数据、授权服务器元数据，
以及带 PKCE 的授权码流程。桥实现了这个连接流程。
客户端界面名称和可用性取决于 ChatGPT 套餐和工作区。

> 兼容性按部署验证。在自己的工作区完成流程前，
> OAuth、工具使用和可选 MCP Apps 渲染都需分别检查。

## 前置条件

1. 部署在 HTTPS origin 上的 Worker，见[部署指南](deployment.zh-CN.md)。
2. 当前套餐和工作区支持 ChatGPT 自定义连接器。
3. 浏览器和 OpenAI 后端都能访问该 origin。
4. `/authorize` 由 Access 保护，或已配置 `OWNER_PASSPHRASE`。
   推荐 Access；配置 Access 后移除口令，避免保留另一条授权路径，
   见[部署指南](deployment.zh-CN.md#加固操作者身份验证)。

## 1. 添加连接器

1. 打开 ChatGPT 设置中的自定义连接器/app 控件。
   已有界面可能标为 **Connectors**、**Advanced** 或 **Developer mode**；
   使用当前工作区提供的控件。
2. 创建自定义连接器，MCP URL 为
   `https://exercise.example.com/mcp`，将示例 origin 替换为自己的。
3. 认证选择 **OAuth**。
   训记 Key 保留在 Worker secret 中，客户端接收 provider 签发的 OAuth token。

使用客户端提供的精确 redirect URI 和客户端身份。
CIMD 已启用；需要 DCR 的客户端可使用 `/oauth/register`。
CIMD 客户端以元数据 URL 作为身份，不需要单独的 DCR 请求。
注册本身不授予访问权限。

## 2. 完成浏览器流程

1. ChatGPT 打开 `https://exercise.example.com/authorize?...`，
   携带 `state`、`code_challenge`、`resource` 和 scope。
2. 如果页面受 Access 保护，在 Access 登录。
3. 授权页显示客户端名称、重定向主机和 scope；
   未使用 Access 时要求部署口令。
4. 批准。桥重定向至 ChatGPT 回调，携带 `code`、`state` 和 `iss`。
5. ChatGPT 在 `/oauth/token` 使用 PKCE verifier 交换 code。

授权页拒绝未验证操作者或无效/过期的授权确认。
无效请求可能显示本地错误页；provider 的批准/拒绝重定向包含 `iss`。

provider 广告 `xunji:read`、`xunji:write` 和 `offline_access`。
当前 consent handler 授予 read，写入启用时才允许 write，并过滤 `offline_access`。
refresh token 轮换和 30 天空闲有效期由 provider 单独实现。

## 3. 验证

确认工具发现后，让模型调用：

```text
xunji_capabilities
```

它返回配置和索引计数，不实时验证上游 Key。
能力矩阵可能与当前 token 可用的工具不同；应检查连接器实际工具清单。

对于已配置历史起点/回填的 D1 部署，调用 `xunji_training_overview`：

```json
{ "range": { "preset": "all_time" }, "includeToday": false }
```

解释 KPI 前，检查返回范围、`coverage.complete`、pending/error 计数和新鲜度。
成功返回部分结果不代表历史覆盖验证完成。

直接读取时，选择私有日期并替换占位符：

```text
xunji_get_training_day  {"date":"YYYY-MM-DD"}
```

私下与训记 App 比较返回的计数/聚合值。
`no_training` 是有效的空读取；延后读取需按重试提示等待。
不要在公开截图或验证报告中放入日期、标题、重量、账号标识或部署细节。

旧版范围/统计工具最多预算两次未缓存读取，并显式返回 `pending`/`deferred`。
后续请求应缩小至 pending 日期，或使用索引；
重复历史范围不是分页。

## 可选 MCP Apps 渲染

操作者可在配置 D1 并启用训练后设置 `MCP_UI_ENABLED=true`。
概览工具会通过 `_meta.ui.resourceUri` 和 `openai/outputTemplate`
关联 `ui://xunji/overview`，MIME 为 `text/html;profile=mcp-app`。

视图使用已有结构化结果，标签为简体中文，不发起网络请求或存储写入。
需单独确认宿主能发现资源并渲染 KPI/月度容量。
概览调用成功不代表 app 渲染成功；不支持的宿主仍可使用文本和结构化数据。

## 排障

| 现象                                                  | 可能原因                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 连接器报告 “OAuth not supported”                      | 授权服务器元数据缺少 S256 或发现路径错误；检查 `/.well-known/oauth-authorization-server` |
| `invalid_redirect_uri`                                | 客户端使用了注册/CIMD 文档中没有的 redirect URI                                          |
| 授权页 403，提示 “Access did not provide an identity” | `/authorize` 没有经 Access 访问，或 JWT audience/team 配置错误                           |
| 连接后 401                                            | token audience 不等于 `PUBLIC_ORIGIN + /mcp`；检查 `PUBLIC_ORIGIN`                       |
| `deferred` 结果                                       | 厂商限制读取频率；等待 `retryAfterSeconds` 后重试                                        |
| 写工具不可用                                          | 默认 `WRITE_TOOLS_ENABLED=false`，属于预期行为                                           |
| 升级后没有新工具                                      | 先检查 token scope/数据域；客户端可能缓存清单。使用其控件刷新或重连，或移除后重新添加    |
| 索引查询显示覆盖不完整                                | 回填/刷新仍待处理、失败或范围早于配置起点；检查 `xunji_history`                          |
| 概览成功但没有 app 视图                               | UI 标记或资源缺失，或宿主不渲染 MCP Apps；单独检查清单                                   |

## 重新授权

移除 `OWNER_PASSPHRASE` 修改未来的授权确认，不改变已有 OAuth 授权。
已有客户端可在 token 有效期间继续访问。
撤销/过期后重连，或请求新启用的 write scope，需要再次执行浏览器流程。
工具缺失时先检查实际 scope 和配置。

1. 在 ChatGPT 中打开连接器，选择 **Reconnect**，
   或移除后使用相同 `/mcp` URL 重新添加。
2. 浏览器打开 `/authorize`。
   Cloudflare Access 要求通过其应用配置的身份提供方登录，例如邮箱一次性验证码或 SSO。
3. 批准授权页。ChatGPT 获取新 code，交换为新的 access/refresh token。

仅使用 Access 时，操作者通过 Access 登录。
仍有效的 Access 会话可能不再显示登录提示。

### Access 本身故障时

恢复由操作者手动、临时处理：

```bash
# 1. 临时配置高熵口令
printf '%s' "$NEW_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE

# 2. 使用口令完成授权确认
# 3. 修复 Access 应用（策略、AUD、team domain），确认 /authorize
#    再次转到 Access 登录，然后移除回退口令
npx wrangler secret delete OWNER_PASSPHRASE
```

即使 Access 设置仍存在，没有 Access 身份时 Worker 也接受有效口令。
它不会绕过在请求到达 Worker 前就拦截浏览器的 Access 网关；
恢复该路由仍需操作者处理。恢复完成后移除口令。

## 撤销访问

有客户端撤销控件时使用它，或通过 provider 的 `revokeGrant`/`deleteClient` helper
撤销服务器端授权。桥没有授权管理端点。
从界面移除客户端条目不能作为服务器端授权已撤销的证明。

access token 有效期为一小时，refresh 授权使用 30 天滑动空闲有效期。
撤销、token 过期和操作者登录方式修改是不同操作。
另见[身份 ADR](adr/0002-oauth-and-identity.zh-CN.md)、
[覆盖说明](coverage.zh-CN.md)和[威胁模型](threat-model.zh-CN.md)。
