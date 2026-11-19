# ADR 0002：OAuth 2.1、操作者身份与单用户允许名单

[English](0002-oauth-and-identity.md) · [简体中文](0002-oauth-and-identity.zh-CN.md)

- 状态：已接受
- 日期：2026-11-19

## 背景

ChatGPT 和其他 MCP 客户端需要带 PKCE 的 OAuth 2.1 授权码流程。
粘贴静态 bearer token 不能按客户端撤销或绑定用户身份，
还会把公开 URL 变成共享 secret，因此不采用。

桥只服务一位操作者的训记账号。
公开动态客户端注册不能成为访问这个账号的路径。

## 决定

使用 `@cloudflare/workers-oauth-provider` 作为授权服务器：

- RFC 9728 受保护资源元数据位于 `/.well-known/oauth-protected-resource/mcp`；
  规范 `resource` 等于 MCP URL，`authorization_servers` 只有当前 origin。
- RFC 8414 授权服务器元数据包含 S256、`resource` 支持、
  provider 重定向中的 RFC 9207 `iss`、撤销端点和 refresh token 轮换。
- 启用 CIMD，当前客户端优先采用；保留 DCR 支持旧客户端。
  注册本身不授予权限，授权需操作者批准。
- `requiredScopes: ["xunji:read"]` 在资源元数据和 challenge 中广告基础 scope；
  应用在注册工具时检查 scope。
- provider 的 `scopesSupported` 静态广告 `xunji:read`、
  `xunji:write` 和 `offline_access`。
  授权页允许 read scope，只有 `WRITE_TOOLS_ENABLED=true` 时允许 write scope；
  它会从授予内容中过滤 `offline_access`。
- access token 有效期一小时。
  refresh token 使用时轮换，初始有效期 30 天，刷新后采用 30 天滑动空闲有效期。
  客户端注册 TTL 为 90 天。
  refresh 行为由 provider 提供，独立于桥对 `offline_access` 的 consent 过滤。

操作者身份在授权时验证，不额外构建 token 系统：

1. **Cloudflare Access（推荐）。**
   `/authorize` 放在仅允许一个邮箱的 Access 应用后面。
   Worker 通过 team JWKS 验证 `Cf-Access-Jwt-Assertion` 签名，
   检查 issuer、audience、有效期和算法，再要求邮箱位于 `ALLOWED_USER_EMAILS`。
   没有头就没有身份，也不授予权限。
2. **部署口令（回退）。**
   不使用 Access 的部署将 `OWNER_PASSPHRASE` 转为 SHA-256 摘要后进行恒定时间比较。
   它是单操作者部署的 secret，不是用户密码库。

两者都未配置时，`/authorize` 返回 503，不创建授权。
配置 Access 且没有口令时，缺少已验证、匹配允许名单的 JWT 返回 403。
两者都配置时，没有 Access 身份仍可通过有效口令授权。
Access 可用后应移除回退口令。

token props 包含 `{ subject, label, scope }`，
其中 `subject` 是操作者身份的截断 SHA-256。
provider 加密 props；授权 user ID 和元数据在存储中仍可见。
label 是清理后的邮箱本地部分或回退操作者标签。
上游 Key 不进入 props、token 或缓存键。

## 影响

- provider 在 `/oauth/token` 支持 RFC 7009 撤销，并提供
  `revokeGrant`/`deleteClient` helper。
  应用没有授权管理端点。
  删除连接器或修改操作者登录方式，不能作为服务器端授权已撤销的证明。
- Access 模式依赖 Access 应用及其 AUD tag；
  `/authorize` 需要保护，而 `/mcp`、`/oauth/*` 和 `/.well-known/*`
  必须可由机器客户端访问。
- Access 策略配置错误时，Worker 仍独立验证 JWT 和邮箱允许名单；
  不信任未签名请求头。
- 口令模式有钓鱼和复用风险，弱于 IdP，供无 Access 的部署使用。
  运行时仍是 Cloudflare Workers。
- 备用主机名需要相同身份验证，或应禁用。
  仅使用 Access 时，Worker 缺少身份仍会拒绝授权。
- 多个允许名单条目不代表多个训记账号。
  D1 和上游 Key 仍属于部署对应的单一账号。
- 关闭写入会移除写工具，即使已有 token 带 write scope。
  Access/口令修改控制未来的授权确认，已有 OAuth 授权使用自己的有效期和撤销机制。

另见[部署](../deployment.zh-CN.md)、[ChatGPT 接入](../chatgpt-connect.zh-CN.md)
和[威胁模型](../threat-model.zh-CN.md)。
