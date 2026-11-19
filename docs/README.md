# Documentation

[English](README.md) · [简体中文](README.zh-CN.md) · [Project](../README.md) · [Website](https://deliciousbuding.github.io/xunji-mcp/)

Start with deployment and client connection, then use the tool reference for arguments and result semantics. Both languages cover the same supported behavior and limitations.

## Use and deploy

| Guide                                   | What it covers                                                      | 简体中文                               |
| --------------------------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| [Deployment](deployment.md)             | Worker, storage, secrets, operator gate, quota, and rollback        | [部署](deployment.zh-CN.md)            |
| [Client connection](chatgpt-connect.md) | ChatGPT OAuth, other MCP clients, reconnecting, and troubleshooting | [客户端接入](chatgpt-connect.zh-CN.md) |
| [Tools](tools.md)                       | Input arguments, results, units, bounds, and errors                 | [工具](tools.zh-CN.md)                 |
| [Coverage](coverage.md)                 | Supported domains and registration/verification conditions          | [覆盖](coverage.zh-CN.md)              |
| [Acceptance](acceptance.md)             | Implemented, tested, live-verified, and pending checks              | [验收](acceptance.zh-CN.md)            |

## Understand the design

| Guide                                      | What it covers                                                                                                                                     | 简体中文                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [Architecture](architecture.md)            | Data path, derived index, cache, and scan coordinator                                                                                              | [架构](architecture.zh-CN.md)               |
| [Upstream contract](api-contract.md)       | Observed endpoints, pacing, gzip, and write behavior                                                                                               | [上游契约](api-contract.zh-CN.md)           |
| [Threat model](threat-model.md)            | Trust boundaries and attack/rejection paths                                                                                                        | [威胁模型](threat-model.zh-CN.md)           |
| [Benchmark](benchmark.md)                  | Synthetic query/output benchmark and reproduction                                                                                                  | [基准](benchmark.zh-CN.md)                  |
| [Decisions](adr/0001-scope-and-runtime.md) | [Scope](adr/0001-scope-and-runtime.md), [OAuth](adr/0002-oauth-and-identity.md), [upstream safety](adr/0003-upstream-contract-and-write-safety.md) | [决策](adr/0001-scope-and-runtime.zh-CN.md) |

## Contribute and follow releases

| Guide               | English                                  | 简体中文                                |
| ------------------- | ---------------------------------------- | --------------------------------------- |
| Contributing        | [CONTRIBUTING](../CONTRIBUTING.md)       | [贡献指南](../CONTRIBUTING.zh-CN.md)    |
| Security            | [SECURITY](../SECURITY.md)               | [安全策略](../SECURITY.zh-CN.md)        |
| Privacy             | [PRIVACY](../PRIVACY.md)                 | [隐私说明](../PRIVACY.zh-CN.md)         |
| Support             | [SUPPORT](../SUPPORT.md)                 | [支持](../SUPPORT.zh-CN.md)             |
| Code of conduct     | [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) | [行为准则](../CODE_OF_CONDUCT.zh-CN.md) |
| Website development | [Website](website.md)                    | [主页开发](website.zh-CN.md)            |
| Changelog           | [CHANGELOG](../CHANGELOG.md)             | [更新记录](../CHANGELOG.zh-CN.md)       |
| Release notes       | [Releases](releases/README.md)           | [版本说明](releases/README.zh-CN.md)    |
| Promotional copy    | [Copy](promo.md)                         | [宣传文案](promo.zh-CN.md)              |

Public samples and site charts are synthetic. Deployment-specific facts and raw account data belong to the operator, and are not part of these guides. The English MIT [license](../LICENSE) is the authoritative license text.
