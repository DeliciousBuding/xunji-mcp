# 宣传文案

[English](promo.md) | [简体中文](promo.zh-CN.md)

以下文案供手动发布。编辑本页不会自动发布内容。
作出兼容性或性能表述前，请检查[核验范围](acceptance.zh-CN.md)。

## 短版

> xunji-mcp 让 MCP 客户端读取你自己的训记训练历史。自行托管在 Cloudflare Workers，支持 OAuth 2.1 + PKCE 和 D1 历史索引，默认只读。MIT 开源。
>
> https://github.com/DeliciousBuding/xunji-mcp

## 长版

> xunji-mcp 通过自行托管的桥，让 ChatGPT 等 MCP 客户端读取你自己的训记训练历史。
>
> - 运行在 Cloudflare Workers，上游 Key 保存在 Worker secrets。
> - OAuth 2.1 支持 CIMD/DCR、PKCE S256、resource audience、refresh 轮换和撤销。
> - 操作者授权采用经验证的 Cloudflare Access 身份及 allowlist，或部署口令。仅注册客户端不能获得数据访问权限。
> - 回填后，D1 支持历史查询、一次调用的概览和动作进展，并显式报告覆盖状态。
> - 保留旧的有界工具，通过 `deferred`、`pending` 和降级 metadata 报告按日上游节奏、缓存和扫描预算。
> - 身体及饮食适配器需要独立 Key 和已启用的数据域；真实核验仍待完成。
> - 可选 MCP Apps 概览显示已有结果，默认关闭，真实 ChatGPT 渲染仍待确认。
> - 训练写入默认关闭，需要 `xunji:write` 和 `confirmed: true`。写入是真实操作：桥不发送 `dry_run`，也没有删除工具。
>
> MIT，无遥测。https://github.com/DeliciousBuding/xunji-mcp

引用数字比较时，请链接[合成基准](benchmark.zh-CN.md)，并保留方法和限制。
D1 索引是持久副本，数据保留及清理方式见[隐私](../PRIVACY.zh-CN.md)。
