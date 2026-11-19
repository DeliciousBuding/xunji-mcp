# 项目主页与视觉资产

[English](website.md) · [简体中文](website.zh-CN.md) · [文档目录](README.zh-CN.md)

GitHub Pages 主页提供公开的中英文项目介绍，使用合成示例并链接到文档。页面不会连接训记或私有 Worker，也不收集账号数据。

## 源码与构建

| 路径                          | 用途                           |
| ----------------------------- | ------------------------------ |
| `site/content.mjs`            | 完整英文与中文文案             |
| `site/render.mjs`             | 共用的语义 HTML 模板与元数据   |
| `site/styles.css`             | 响应式布局与视觉样式           |
| `site/client.js`              | 支持键盘的演示选项卡与命令复制 |
| `site/cover.html`             | 居中横幅的 HTML/CSS 排版       |
| `scripts/build-site.mjs`      | 无依赖的静态构建               |
| `scripts/render-cover.mjs`    | 1× 和 2× 浏览器截图            |
| `.github/workflows/pages.yml` | GitHub Pages 构建与发布        |

```bash
npm run site:build
```

构建输出 `dist/site/index.html`、`dist/site/zh/index.html`，以及本地 CSS、JavaScript、图片、sitemap 和 robots.txt。`dist/` 已被 Git 忽略。仅需 Node.js，不需要服务进程、密钥或上游请求。

页面使用独立语言地址：

- English：<https://deliciousbuding.github.io/xunji-mcp/>
- 简体中文：<https://deliciousbuding.github.io/xunji-mcp/zh/>

构建为每种语言生成语言链接、`lang`、canonical、`hreflang` 与分享元数据。正文仍是可选择的文字，本地字体避免远程字体请求。

## 设计与交互

页面使用石墨深色、柔和蓝色背景、圆角图标，以及 Manrope 与思源黑体。横幅中的 logo 和中英文文字沿同一中轴排列。项目原始 logo 保持不变，图表和数字均明确标为合成数据。

演示选项卡支持点击及 Left/Right/Home/End 键，并同步 `aria-selected`。复制按钮通过状态文字提示成功或手动复制方式。常见问题使用原生 `details`；关闭 JavaScript 后仍可使用章节链接、语言切换与文档入口。动画遵从 `prefers-reduced-motion`。

## 图片导出

| 资产                        | 实际尺寸          | 用途                                |
| --------------------------- | ----------------- | ----------------------------------- |
| `assets/icon.png`           | 512×512           | 项目与 MCP 图标                     |
| `assets/readme-cover.png`   | 2560×1280         | README 与 Release 的 2× 横向横幅    |
| `assets/social-preview.png` | 1280×640          | GitHub Social preview 与 Open Graph |
| `site/cover.html`           | 1280×640 CSS 画布 | 可编辑的 HTML/CSS 横幅              |
| `assets/fonts/*.woff2`      | 本地字体子集      | 横幅与主页字体                      |

README 将 2× PNG 以最大 1280 CSS 像素宽度展示，GitHub 根据正文列宽自动适配。两种横幅均为 2:1。浏览器等待字体和图片加载后按目标像素密度渲染 HTML/CSS，原始 icon 不放大到超过原生尺寸。

安装开发依赖及 Edge 浏览器后，可复现 PNG：

```bash
npm ci
npm run cover:render
```

`playwright-core` 以隐藏方式启动本地浏览器，从磁盘打开 `site/cover.html`，
等待字体加载并截图。远程请求被阻止，不需要本地服务器、API Key 或生成图片服务。
设置 `COVER_BROWSER=chrome` 可使用已安装的 Chrome。

仓库中的 Manrope 与 Noto Sans SC WOFF2 为
[Google Fonts](https://github.com/google/fonts) 开源字体的子集，SIL Open Font License
原文保留在 `assets/fonts/OFL-Manrope.txt` 和 `assets/fonts/OFL-Noto-Sans-SC.txt`。
中文子集覆盖当前主页与横幅文案；新增中文时应扩充子集，否则缺失字形由浏览器
回退字体提供。

## 发布与回滚

将 GitHub Pages 来源设为 GitHub Actions，再把主页改动推送到 `main`。Pages workflow 只上传 `dist/site`，不会上传仓库、部署配置或密钥。页面的版本链接来自 package 版本。

回滚主页时 revert 对应源码提交，再由 Pages 发布构建结果。主页版本不会部署私有 MCP Worker；Worker 部署与回滚见[部署指南](deployment.zh-CN.md)。

GitHub Social preview 是与 Pages 独立的仓库设置。检查最终资产后，在仓库 Settings 上传 `assets/social-preview.png`。
