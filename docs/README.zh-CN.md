# 文档目录

[English](README.md) · [简体中文](README.zh-CN.md) · [项目](../README.zh-CN.md) · [主页](https://deliciousbuding.github.io/xunji-mcp/zh/)

从部署与客户端接入开始，使用时通过工具说明查询参数和结果含义。中英文覆盖相同的支持范围与限制。

## 使用与部署

| 文档                                   | 内容                                           | English                                 |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| [部署](deployment.zh-CN.md)            | Worker、存储、密钥、本人授权、额度与回滚       | [Deployment](deployment.md)             |
| [客户端接入](chatgpt-connect.zh-CN.md) | ChatGPT OAuth、其他 MCP 客户端、重新连接与排障 | [Client connection](chatgpt-connect.md) |
| [工具](tools.zh-CN.md)                 | 参数、结果、单位、范围与错误                   | [Tools](tools.md)                       |
| [覆盖](coverage.zh-CN.md)              | 支持的数据领域、注册与验证条件                 | [Coverage](coverage.md)                 |
| [验收](acceptance.zh-CN.md)            | 已实现、已测试、已真实验证与待完成项           | [Acceptance](acceptance.md)             |

## 理解设计

| 文档                                        | 内容                                                                                                                                                         | English                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [架构](architecture.zh-CN.md)               | 数据路径、派生索引、缓存与扫描协调                                                                                                                           | [Architecture](architecture.md)            |
| [上游契约](api-contract.zh-CN.md)           | 已观察的接口、限频、gzip 与写行为                                                                                                                            | [Upstream contract](api-contract.md)       |
| [威胁模型](threat-model.zh-CN.md)           | 信任边界、攻击与拒绝路径                                                                                                                                     | [Threat model](threat-model.md)            |
| [基准](benchmark.zh-CN.md)                  | 合成查询与输出基准、复现方式                                                                                                                                 | [Benchmark](benchmark.md)                  |
| [决策](adr/0001-scope-and-runtime.zh-CN.md) | [范围](adr/0001-scope-and-runtime.zh-CN.md)、[OAuth](adr/0002-oauth-and-identity.zh-CN.md)、[上游安全](adr/0003-upstream-contract-and-write-safety.zh-CN.md) | [Decisions](adr/0001-scope-and-runtime.md) |

## 参与贡献与关注版本

| 内容     | 简体中文                                | English                                  |
| -------- | --------------------------------------- | ---------------------------------------- |
| 参与贡献 | [贡献指南](../CONTRIBUTING.zh-CN.md)    | [CONTRIBUTING](../CONTRIBUTING.md)       |
| 安全     | [安全策略](../SECURITY.zh-CN.md)        | [SECURITY](../SECURITY.md)               |
| 隐私     | [隐私说明](../PRIVACY.zh-CN.md)         | [PRIVACY](../PRIVACY.md)                 |
| 支持     | [支持](../SUPPORT.zh-CN.md)             | [SUPPORT](../SUPPORT.md)                 |
| 社区     | [行为准则](../CODE_OF_CONDUCT.zh-CN.md) | [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md) |
| 主页开发 | [主页](website.zh-CN.md)                | [Website](website.md)                    |
| 变更     | [更新记录](../CHANGELOG.zh-CN.md)       | [CHANGELOG](../CHANGELOG.md)             |
| 版本     | [版本说明](releases/README.zh-CN.md)    | [Releases](releases/README.md)           |
| 宣传     | [宣传文案](promo.zh-CN.md)              | [Copy](promo.md)                         |

公开样例和主页图表均为合成数据。部署实例与账号原始数据由操作者保管，不属于这些公开指南。英文 MIT [许可](../LICENSE)是权威许可文本。
