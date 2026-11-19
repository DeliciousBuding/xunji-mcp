# 支持

[English](SUPPORT.md) | [简体中文](SUPPORT.zh-CN.md)

## 去哪里提问

- 使用和部署问题：使用[提问模板](https://github.com/DeliciousBuding/xunji-mcp/issues/new?template=question.zh-CN.md)，
  说明部署方式。
- 行为不符合预期：使用[问题反馈模板](https://github.com/DeliciousBuding/xunji-mcp/issues/new?template=bug_report.zh-CN.md)。
- 能力请求或文档改进：使用[功能建议模板](https://github.com/DeliciousBuding/xunji-mcp/issues/new?template=feature_request.zh-CN.md)。
- 漏洞或敏感披露：按[安全政策](SECURITY.zh-CN.md)提交私密报告。

## 应提供哪些信息

- 桥的版本或 tag、MCP 客户端及传输方式。
- 已知的注册方式（CIMD 或 DCR），以及浏览器或 CLI 授权方式。
- `/authorize` 使用 Cloudflare Access 还是口令；是否开启写入、索引或可选 UI。
- 工具名、脱敏后的错误码和合成复现。
- 实际运行过的检查及其范围。源码修改的本地检查集合是 `npm run check`。

不要包含 API Key、OAuth token、真实记录或聚合统计、账号标识、邮箱、
私有域名和部署 ID。分享日志或截图前，将个人日期、重量和计数替换为合成样例。

## 能力和支持边界

一个 Worker 只服务一个训记账号。多租户部署、恢复已删除的源记录、
医疗或训练建议不在项目范围内。

身体测量、饮食记录和食品搜索已有可选适配器。
注册前需要对应 secret（`XUNJI_BODY_KEY`、`XUNJI_FOOD_KEY`、
`XUNJI_FOOD_SEARCH_KEY`）以及数据域配置。
这些适配器尚未通过真实上游核验；使用前请检查 `xunji_capabilities`
和[验收记录](docs/acceptance.zh-CN.md)。

MCP Apps 概览为可选功能，默认关闭。资源注册有历史核验记录，
真实 ChatGPT 渲染仍是客户端侧待确认项。报告 UI 问题时请说明客户端和版本。

训练写入是真实操作，默认关闭，需要 `xunji:write` 和 `confirmed: true`。
没有 dry run 或删除工具。可携带 `localid` 更新已有 session，
或在训记 App 中管理记录。

操作者负责管理 Key、grant、备份和清理。Key 轮换仍需操作者确认。
数据保留方式见[隐私](PRIVACY.zh-CN.md)，实例设置见[部署指南（英文）](docs/deployment.md)。
