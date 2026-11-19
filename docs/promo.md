# Promotional copy

Ready-to-post blurbs. Nothing here is published automatically; the repository
and release notes are the only places these have been used.

## English (short)

> xunji-mcp: a small, self-hosted MCP bridge for Xunji (训记) training data on Cloudflare Workers. OAuth 2.1 with PKCE, a single-operator allowlist, read-first tools, and honest handling of the vendor's 15s/30s per-day rate limits. MIT.
>
> https://github.com/DeliciousBuding/xunji-mcp

## English (longer)

> I built xunji-mcp, a lightweight bridge that lets ChatGPT and other MCP clients read your own Xunji training history.
>
> - Runs entirely on Cloudflare Workers; your Xunji key stays in a Worker secret.
> - Real OAuth 2.1: CIMD/DCR, PKCE S256, resource audience, refresh rotation, revocation.
> - Authorization is gated by Cloudflare Access (verified JWT + email allowlist), so public client registration never becomes data access.
> - Tools return compact, normalized days, ranges, movement history and aggregates — not raw vendor payloads.
> - The vendor paces reads at 15s/30s per day, so the bridge caches, budgets and reports `deferred`/`pending` instead of hanging.
> - Writes are off by default; the vendor ignores `dry_run`, so the bridge never pretends a preview is safe.
>
> MIT, no telemetry. https://github.com/DeliciousBuding/xunji-mcp

## 中文（短）

> xunji-mcp：跑在 Cloudflare Workers 上的训记训练数据 MCP 桥。标准 OAuth 2.1 + PKCE、单用户 allowlist、只读优先；如实处理训记 15/30 秒的按日限频。MIT 开源。
>
> https://github.com/DeliciousBuding/xunji-mcp

## 中文（长）

> 做了个 xunji-mcp，让 ChatGPT 等 MCP 客户端读取自己的训记训练记录。
>
> - 全部跑在 Cloudflare Workers，训记 Key 只存 Worker Secret，不发给客户端。
> - 真 OAuth 2.1：CIMD/DCR、PKCE S256、resource 受众、refresh 轮换与撤销。
> - 授权由 Cloudflare Access 把关（校验 JWT + 邮箱 allowlist），公开注册客户端拿不到数据。
> - 返回归一化后的单日、区间、动作历史与聚合统计，不是上游原始大 payload。
> - 训记按“账号 + 训练日”限频 15/30 秒，桥会缓存、限预算，并明确返回 `deferred`/`pending`。
> - 写入默认关闭；实测上游忽略 `dry_run`，所以桥从不把“预览”说成安全。
>
> MIT，无遥测。https://github.com/DeliciousBuding/xunji-mcp
