# 贡献指南

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

贡献应解决具体的桥接、契约或文档问题，保留单账号设计，
并让训记继续作为事实源。参与社区须遵守[行为准则](CODE_OF_CONDUCT.zh-CN.md)。

## 基本规则

- 代码、测试、fixture、文档、截图和提交历史中不得包含真实训练数据、
  API Key、token、私有域名、邮箱或账号 ID。使用合成 fixture 和 `example.com`。
- 不编造上游接口或字段。上游契约不明确时，标记为未核实。
- 训练写入默认关闭，须具备 `WRITE_TOOLS_ENABLED=true`、`xunji:write`
  和 `confirmed: true`。上游忽略 `dry_run`；桥不得发送它或宣称预览安全。
  不增加删除工具。
- 可选身体和饮食适配器需要独立上游 Key 和已启用的数据域。
  区分实现、配置和真实核验状态。
- 涉及安全的修改需要验证拒绝路径，不能只验证成功路径。

## 开发

```bash
npm ci
cp wrangler.example.jsonc wrangler.jsonc
npm run cf-typegen
npm run typecheck
npm test
node scripts/secret-scan.mjs --history
```

使用 Node 20+ 及 lockfile 中的依赖。实例配置保持私有。
本地扫描时，将 `PRIVATE_DOMAIN` 设为部署域名，
让扫描器能够检查它，无须把个人域名写进源码。

测试通过 `@cloudflare/vitest-pool-workers` 在 workerd 中运行。
上游 HTTP 使用 stub，测试不访问真实训记账号。

`npm run check` 还包括 lint 和格式检查。仅修改文档时，
格式化变更的 Markdown 并检查链接，汇报实际执行的检查。
不要为验证文案运行生产探测。

## Pull request

- 一个 PR 只处理一个主题。
- 说明用户可见结果和实际核验范围，包括待操作者或客户端处理的事项。
- 行为、限制、scope 或存储变化时，同步受影响的公开文档、验收记录和 changelog。
- 英文与 `.zh-CN.md` 文档须完整且一致，提供语言导航，
  有对应译文时使用译文链接。
- CI 检查 typecheck、lint、格式、测试、凭据模式和运行时依赖审计。
  历史验收条目不能当作新的测试结果。
- 保留已有 release tag。Release 文案应描述 tag 对应的源码，
  不能把后续提交算入旧版本。

## 报告问题

Issue 模板及所需信息见[支持](SUPPORT.zh-CN.md)。
漏洞请使用[安全政策](SECURITY.zh-CN.md)中的私密渠道。
