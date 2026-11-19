# 部署

[English](deployment.md) · [简体中文](deployment.zh-CN.md)

目标是一个 Cloudflare Worker、一个自定义域名、一个训记账号。
下文的主机名、邮箱和资源 ID 都是公开占位符。
部署命令只应针对你控制的基础设施运行。

## 1. 前置条件

- Node 20+ 和 Wrangler 4。
- 一个你控制的 Cloudflare zone。
- 从训记 App 的训练数据 Skill 获取的 Open API Key。
- 可选但推荐：为 `/authorize` 配置 Cloudflare Access 应用。

安装仓库依赖并创建私有配置：

```bash
npm ci
cp wrangler.example.jsonc wrangler.jsonc
```

不要将 `wrangler.jsonc` 提交到 Git。
修改部署值时，保留示例中的 KV、D1、Durable Object 绑定及迁移声明。

## 2. 创建两个 KV namespace

```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create CACHE_KV
```

将返回的 namespace ID 填入私有 `wrangler.jsonc`，不要将它们作为验证结果发布。

## 3. 创建派生索引（D1）

```bash
npx wrangler d1 create xunji-mcp-index
# 将返回的 ID 填入 wrangler.jsonc 的 d1_databases[0].database_id
npx wrangler d1 migrations apply xunji-mcp-index --remote
```

示例将 D1 绑定为 `DB`、`UpstreamGate` 绑定为 `UPSTREAM_GATE`，
`ScanCoordinator` 绑定为 `SCAN_COORDINATOR`。
它声明 SQLite Durable Object 迁移 `v1`/`v2`，以及 `migrations/` 下的 D1 迁移；
部署时应保留这些绑定。

D1 保存派生数据、扫描状态，以及缓存/扫描预算计数器。
可通过回填重建，不修改训记。
移除它也会移除本地控制状态和缓存写入计数器。
有界单日读取不强制要求 D1，但索引分析和缓存 put 需要 D1；
历史控制还需要扫描器绑定。

## 4. 配置 Worker

将以下设置合入 `wrangler.jsonc`；这个片段不能替代示例中的绑定和迁移：

```jsonc
{
  "vars": {
    "PUBLIC_ORIGIN": "https://exercise.example.com",
    "MCP_RESOURCE_PATH": "/mcp",
    "ALLOWED_USER_EMAILS": "you@example.com",
    "ENABLED_DATA_DOMAINS": "train",
    "WRITE_TOOLS_ENABLED": "false",
    "UPSTREAM_TIMEOUT_MS": "15000",
    "KV_WRITE_DAILY_BUDGET": "300",
    "SCAN_DAILY_LIMIT": "100",
    "MCP_UI_ENABLED": "false",
  },
  "workers_dev": false,
  "triggers": { "crons": ["10 16 * * *"] },
  "routes": [{ "pattern": "exercise.example.com", "custom_domain": true }],
}
```

`PUBLIC_ORIGIN` 是 OAuth issuer 和资源 origin，必须与公开 URL 精确一致；
OAuth 客户端按字符串比较。
使用没有末尾斜杠的规范 HTTPS origin。
示例启用 `global_fetch_strictly_public`，provider 管理的 CIMD 请求需要这个标记。

`ENABLED_DATA_DOMAINS` 默认为 `train`。
身体/饮食工具同时需要启用数据域和对应独立 secret。
适配器未经过真实响应验证；添加 Key 不代表验证完成。

## 5. Secrets

```bash
printf '%s' "$XUNJI_KEY_READ_FROM_YOUR_OWN_STORE" | npx wrangler secret put XUNJI_API_KEY
```

不要把 Key 作为命令行参数传入，以免进入 shell 历史和进程列表。
优先从文件或已经在当前环境中的变量通过管道传入。

身份验证方式见下一节。不使用 Access 的部署采用高熵口令：

```bash
printf '%s' "$OWNER_PASSPHRASE" | npx wrangler secret put OWNER_PASSPHRASE
```

可选的操作者端点提供回填、索引状态和工具清单：

```bash
printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
```

使用 Access 替代口令时：

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN   # team.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # Access 应用的 AUD tag
```

`ALLOWED_USER_EMAILS` 是逗号分隔的私有允许名单。
Access 模式必须匹配一个条目；空名单不能授权任何人。
口令模式在有名单时使用第一个条目作为 label/subject，否则使用回退操作者身份。

可选独立 Key 为 `XUNJI_BODY_KEY`、`XUNJI_FOOD_KEY` 和 `XUNJI_FOOD_SEARCH_KEY`。
配置时使用 `wrangler secret put`，私下验证只读契约，并明确启用 `body` 或 `nutrition`。
所有数据域 Key 应对应本次部署的同一操作者账号。

## 6. 用 Cloudflare Access 保护 `/authorize`（推荐）

为 `<your-domain>/authorize` 创建自托管 Access 应用，只保护这个路径，
策略仅允许操作者邮箱。机器访问路径必须绕过 Access：

| 路径             | Access                          |
| ---------------- | ------------------------------- |
| `/authorize`     | 策略：一个邮箱                  |
| `/mcp`           | 绕过，由 OAuth 保护             |
| `/oauth/*`       | 绕过，OAuth 端点                |
| `/.well-known/*` | 绕过，发现端点                  |
| `/healthz`       | 可绕过或保护；只返回配置元数据  |
| `/admin/*`       | 绕过；要求 `ADMIN_TOKEN` Bearer |

Worker 独立验证 Access JWT 签名、issuer、audience、有效期和邮箱允许名单。
仅使用 Access 时，没有有效且匹配名单的 JWT 会返回 403。
同时配置口令时，口令仍是另一条授权路径。

### 加固操作者身份验证

有两项设置容易遗漏，并会扩大授权入口：

**禁用 `workers.dev` 路由。**
Access 策略绑定主机名。即使自定义域名已保护，
默认 `https://<worker>.<account>.workers.dev` 地址仍会绕过 Access 应用。
在 **Workers & Pages → the Worker → Settings → Domains & Routes** 中禁用，
或在 `wrangler.jsonc` 设置 `"workers_dev": false` 后重新部署。
检查备用主机名已无活动路由；部署专用探测可使用：

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<worker>.<account>.workers.dev/healthz
# 预期：404 或没有路由
```

**配置 Access 后移除 `OWNER_PASSPHRASE`。**
它是另一把可从任何到达 Worker 的入口使用的钥匙。
Access 配好后删除：

```bash
npx wrangler secret delete OWNER_PASSPHRASE
```

Access 故障时，可从密码管理器临时恢复口令，
见 [ChatGPT 接入](chatgpt-connect.zh-CN.md#重新授权)。
删除后，`/authorize` 只接受 Access 身份；
没有 Access JWT 的直接请求返回 403。

## 7. 部署

```bash
npm run typecheck && npm test
```

发布前还要运行仓库要求的 lint/格式和 secret 检查：

```bash
npm run lint
npm run format:check
node scripts/secret-scan.mjs --history
npx wrangler deploy
```

这些检查使用仓库的合成/stub 验证方式，
不证明客户端兼容性或真实索引完整性。

## 8. 部署后检查

```bash
curl -s https://exercise.example.com/healthz
curl -si https://exercise.example.com/.well-known/oauth-protected-resource/mcp
curl -si https://exercise.example.com/.well-known/oauth-authorization-server
curl -si -X POST https://exercise.example.com/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

预期 health 的 `configured` 包含 `upstreamKey: true` 和 `operatorGate: true`；
有绑定时还包含 index/scanner 标记。
响应同时包含版本、身份模式、允许名单计数和 UI/写入标记。
元数据指向规范资源；未认证 `/mcp` 返回 401，
`WWW-Authenticate` challenge 包含 `resource_metadata` 和 `scope="xunji:read"`。

health 只检查配置是否存在，不检查 Key 有效性或迁移完成情况。
通过 OAuth 连接并检查 `tools/list` 后，再使用能力行作判断。
可选 `GET /admin/tools` 携带 `ADMIN_TOKEN`，返回只读工具和资源清单，不读取上游。

选择历史范围后启动索引回填。
以下 MCP 请求使用日期占位符，需替换为操作者预期的历史起点：

```json
{ "action": "backfill", "start": "YYYY-MM-DD" }
```

也可使用操作者端点，从私有配置提供 `HISTORY_START_DATE`：

```bash
printf '{"start":"%s"}' "$HISTORY_START_DATE" | \
  curl -X POST https://exercise.example.com/admin/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @-
curl https://exercise.example.com/admin/index -H "Authorization: Bearer $ADMIN_TOKEN"
```

正常单协调器循环下，扫描器每个 UTC 日最多尝试 `SCAN_DAILY_LIMIT` 个日期；
预算耗尽后，在下一次 UTC 午夜后不久恢复。
它跳过 KV 读取/写入，将数据和队列状态保存到 D1。
接受回填请求不代表完成；应检查请求范围的覆盖状态。

设置 `MCP_UI_ENABLED=true` 可暴露[工具说明](tools.zh-CN.md)中的可选 MCP Apps 视图。
默认关闭。视图需要 D1 和训练 read scope，
显示已有结构化结果，不增加网络访问或存储。
需在选定宿主中单独确认渲染。

cron `10 16 * * *`（`Asia/Shanghai` 的 00:10）维护尾部数据：
将最新 complete/empty 日期之后直到昨天的缺口入队，再启动相同扫描器。
没有已保存历史起点或 `HISTORY_START_DATE` 时不执行。
自动扫描排除今天。cron 不刷新更早的修改或最新终态之前的缺口；
这些日期需用 `xunji_history action=refresh`。
单日替换跨多个批次，失败后应检查覆盖状态。

随后连接客户端，见 [ChatGPT 接入](chatgpt-connect.zh-CN.md)，
并调用 `xunji_capabilities` 和 `xunji_training_overview`。
真实读取值和部署专用结果保留在操作者私有记录中；
公开内容只写通用验证方法和未解决的能力限制。

## 启用写入

默认读取为主的部署保持 `WRITE_TOOLS_ENABLED=false`。
启用标记只允许在 OAuth token 同时有 read/write scope 且启用训练时注册写工具。
已有只读授权需要重新授权才能取得 write scope。
每次调用都要求 `confirmed: true`。

每次 upsert 都是真实上游写入，没有 `dry_run` 或删除路径。
调用前确认确切训练修改，回读结果，并单独刷新 D1。
upsert 不更新索引，也不会使 full 缓存条目失效。
关闭标记会移除写工具，即使 token 已有 write scope。

## 回滚

用 `wrangler versions` 查看版本历史，用 `wrangler rollback [version-id]`
恢复之前的 Worker 版本。
配置或 secret 修改后，应检查 Wrangler 输出和活动版本，
不能只凭本地编辑认定已生效。

Worker 回滚不会撤销上游写入、D1 扫描变化或 OAuth KV 变化。
回退代码前检查绑定和 schema 兼容性。

桥本身故障时，先移除 Workers 路由/自定义域名。
诊断期间可保留 OAuth KV 和缓存，但它们仍含敏感授权与训练数据。
怀疑训记 Key 暴露时，在训记 App 中轮换，并通过 provider 支持的 helper 撤销受影响授权。

## 成本与配额

根据当前 Cloudflare 账号限制估算部署规模。
代码提供缓存和扫描预算，不限制整个账号的总账单：

- 历史日期不缓存；只有今天/昨天使用 KV。
- `KV_WRITE_DAILY_BUDGET` 默认每个 UTC 日 300 次缓存 put 尝试。
  超预算、缺少 D1 或写入失败时跳过。
  当前单日工具不将缓存层降级标记传入工具元数据。
- 回填不写 KV；写 D1 并遵守 `SCAN_DAILY_LIMIT`。
- provider 的 `OAUTH_KV` 写入不包含在缓存预算中。
- `/admin/index` 返回 `kv.used`、`kv.budget`、
  `scanBudget.used` 和 `scanBudget.remaining`；
  `kv.used` 是尝试计数，不是确认后的全账号写入总数。

这些检查和控制的边界见[覆盖说明](coverage.zh-CN.md)和[威胁模型](threat-model.zh-CN.md)。
