# 更新记录

[English](CHANGELOG.md) · [简体中文](CHANGELOG.zh-CN.md) · [版本说明](docs/releases/README.zh-CN.md)

## 0.3.1 — 2026-11-19

### 新增

- 中英双语 GitHub Pages 项目主页，使用独立语言地址、合成交互示例、
  支持键盘的控件与本地资产。
- 架构、上游契约、工具、部署、客户端接入、隐私、安全、贡献和验收文档的
  完整中文版本。
- 双语历史 Release 文案与统一文档目录。
- 居中圆角 logo 横幅、本地 Manrope 与思源黑体、可编辑 HTML/CSS，
  浏览器截图导出的 2560×1280 README 横幅与 1280×640 社交预览。
- v0.3.0 tag 之后加入的项目图标、README 视觉与 MCP `icons` 元数据。

### 调整

- README 按训练问题、支持范围、起步与验证状态组织，中英文导航一致。
- 隐私与支持指南同步 D1、短期 KV 缓存、Durable Object 状态，以及可选的
  身体与饮食适配器。
- 公开验收文档移除个人训练统计与私有部署标识。

### 修复

- `xunji_capabilities` 使用统一服务版本，替代过期的 v0.2.0 固定值。
- 授权页补充分析索引的持久存储说明，与 OAuth 状态及读取缓存一同展示。
- lockfile 更新 `npm audit fix` 提供的兼容补丁，测试池依赖的剩余告警记录在验收文档中。

## 0.3.0 — 2026-11-19

### 新增

- `xunji_training_overview` 的可选 MCP Apps 视图
  （`ui://xunji/overview`，`text/html;profile=mcp-app`），提供 KPI、
  月度容量图、覆盖状态和宿主主题支持。单个独立 HTML，无外部请求，
  不增加数据访问，保留文本输出。
- `MCP_UI_ENABLED=true` 时，工具声明 `_meta.ui.resourceUri` 与
  ChatGPT Apps SDK 的 `openai/outputTemplate`；默认关闭。

## 0.2.1 — 2026-11-19

### 新增

- 每日 cron（`10 16 * * *`，Asia/Shanghai 00:10）只把最新已完成或空日到
  昨天之间的缺口加入扫描任务，再启动现有 scanner。无需客户端访问即可
  刷新索引尾部，当天在次日建立索引。

### 调整

- 示例配置默认 `workers_dev=false`，避免从账号的 `workers.dev` 域名绕过
  Access 授权入口。
- 部署、ChatGPT、威胁模型和安全文档说明本人授权入口与撤销连接后的
  重新授权流程。

## 0.2.0 — 2026-11-19

### 新增

- 用于多年历史与 SQL 聚合的 D1 派生索引。
- `xunji_query_training`、`xunji_training_overview`、
  `xunji_movement_progress`、`xunji_history`。
- Durable Object alarm 后台回填，支持断点继续、覆盖状态、退避、
  上游编辑或删除后的替换，以及暂停与恢复。
- 可选的身体和饮食适配器，仅在独立 Key 配置后注册。
- `xunji_capabilities` 中的领域覆盖与 `configured`/`verified` 状态。
- 一年、三年合成基准及额度限制。

### 调整

- 日历日期按 `Asia/Shanghai` 解释。
- 为 v0.1 客户端保留有限窗口工具，新接入使用查询工具。
- 查询工具以 `structuredContent` 返回简洁的列式数据，文本只给摘要，
  避免重复 JSON。

### 修复

- 历史读取不写 KV；只有今天与昨天使用短期缓存。
- 扫描路径不写 KV，并遵从默认每天 100 天的预算。
- 缓存写入默认限制为每天 300 次，为同账号其他 Workers 保留额度。
- 官方计划默认窗口遵从上游契约（-7 天到 +30 天）。

## 0.1.0 — 2026-11-19

初始版本。

- Cloudflare Workers 上的 MCP Streamable HTTP 端点。
- 通过 `@cloudflare/workers-oauth-provider` 提供 OAuth 2.1：CIMD 与 DCR、
  PKCE S256、RFC 9728 资源元数据、RFC 8414 授权服务器元数据、
  RFC 9207 `iss`、resource 受众、refresh 轮换与撤销。
- 本人授权入口：Access JWT 加邮箱 allowlist，或部署口令；
  均未配置时拒绝授权。
- 读取工具：能力、单日、区间、动作历史、统计、动作库与官方计划。
- 默认关闭的可选写工具，从不发送 `dry_run`。
- 按身份隔离的缓存与按日 Durable Object，处理上游 15/30 秒间隔及 cooldown。
- 单元、契约与 workerd 集成测试，CI 包含凭据扫描。
