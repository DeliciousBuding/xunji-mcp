import { copy } from './content.mjs';

const repo = 'https://github.com/DeliciousBuding/xunji-mcp';
export const siteUrl = 'https://deliciousbuding.github.io/xunji-mcp';

const escape = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });

const icons = {
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  right: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chart: '<path d="M5 19V9m7 10V5m7 14v-6"/>',
  trend: '<path d="m4 17 6-6 4 3 6-9m-5 0h5v5"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  github:
    '<path d="M9 19c-4 1-4-2-6-3m12 6v-3a3 3 0 0 0-1-2c3 0 6-1 6-5a4 4 0 0 0-1-3 4 4 0 0 0 0-3s-1 0-3 1a11 11 0 0 0-6 0C8 5 7 5 7 5a4 4 0 0 0 0 3 4 4 0 0 0-1 3c0 4 3 5 6 5a3 3 0 0 0-1 2v4"/>',
};
const icon = (name, className = '') =>
  `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

export function renderPage(language, version) {
  const c = copy[language];
  const zh = language === 'zh';
  const assets = zh ? '../assets/' : 'assets/';
  const prefix = zh ? '../' : '';
  const suffix = zh ? '.zh-CN' : '';
  const doc = (name) => `${repo}/blob/main/docs/${name}${suffix}.md`;
  const rootDoc = (name) => `${repo}/blob/main/${name}${suffix}.md`;
  const links = {
    docs: doc('README'),
    security: rootDoc('SECURITY'),
    releases: `${repo}/releases`,
  };
  const canonical = `${siteUrl}/${zh ? 'zh/' : ''}`;
  const bars = (values, unit, className = '') =>
    `<div class="bar-chart ${className}">${values
      .map(
        (value, index) =>
          `<div class="chart-column"><span class="bar-value">${escape(value)}${unit ? `<span>${escape(unit)}</span>` : ''}</span><div class="bar-track"><span class="bar bar-${index}" style="height: ${(value / Math.max(...values)) * 100}%"></span></div><span class="bar-label">${escape(c.months[index])}</span></div>`,
      )
      .join('')}</div>`;
  const setup =
    'npm install\ncp wrangler.example.jsonc wrangler.jsonc\nnpx wrangler types\nnpm run check';

  return `<!doctype html>
<html lang="${c.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#080a0e">
  <title>${escape(c.title)}</title>
  <meta name="description" content="${escape(c.description)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escape(c.title)}">
  <meta property="og:description" content="${escape(c.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="${c.locale}">
  <meta property="og:image" content="${siteUrl}/assets/social-preview.png">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="640">
  <meta property="og:image:alt" content="xunji-mcp · Your training. A new perspective.">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${siteUrl}/assets/social-preview.png">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${siteUrl}/">
  <link rel="alternate" hreflang="zh-CN" href="${siteUrl}/zh/">
  <link rel="alternate" hreflang="x-default" href="${siteUrl}/">
  <link rel="icon" type="image/png" href="${assets}icon.png">
  <link rel="stylesheet" href="${prefix}styles.css">
  <script src="${prefix}client.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">${c.skip}</a>
  <header class="site-header">
    <nav class="nav shell" aria-label="${zh ? '主导航' : 'Main navigation'}">
      <a class="brand" href="./" aria-label="xunji-mcp ${zh ? '首页' : 'home'}">
        <img src="${assets}icon.png" width="32" height="32" alt="">
        <span>xunji-mcp</span>
      </a>
      <div class="nav-links">
        <a href="#experience">${c.nav[0]}</a>
        <a href="#how-it-works">${c.nav[1]}</a>
        <a href="#get-started">${c.nav[2]}</a>
        <a href="${links.docs}">${c.nav[3]}</a>
      </div>
      <div class="nav-actions">
        <a class="language" href="${zh ? '../' : 'zh/'}" lang="${zh ? 'en' : 'zh-CN'}" hreflang="${zh ? 'en' : 'zh-CN'}" aria-label="${c.languageLabel}">${c.language}</a>
        <a class="github-link" href="${repo}" aria-label="GitHub">${icon('github')}</a>
      </div>
    </nav>
  </header>
  <main id="main">
    <section class="hero shell" aria-labelledby="hero-title">
      <div class="hero-atmosphere" aria-hidden="true"></div>
      <a class="release-pill" href="${repo}/releases/tag/v${version}">
        <span class="status-dot"></span>${c.release.replace('{version}', version)}<span class="pill-separator"></span><span>${c.releaseLabel}</span>${icon('right')}
      </a>
      <div class="hero-lockup">
        <div class="app-icon"><img src="${assets}icon.png" width="512" height="512" alt="xunji-mcp"></div>
        <div class="hero-copy">
          <p class="eyebrow">${c.eyebrow}</p>
          <h1 id="hero-title">${c.headline[0]}<br><span>${c.headline[1]}</span></h1>
          <p class="hero-intro">${c.intro}</p>
          <div class="hero-buttons">
            <a class="button button-primary" href="#get-started">${c.primary}${icon('right')}</a>
            <a class="button button-secondary" href="${repo}">${c.secondary}${icon('arrow')}</a>
          </div>
          <ul class="signals">${c.signals.map((signal) => `<li>${escape(signal)}</li>`).join('')}</ul>
        </div>
      </div>
      <p class="hero-note">${icon('shield')}${c.heroNote}</p>
      <div class="demo" aria-label="${c.demoLabel}">
        <div class="demo-top"><div class="demo-brand"><img src="${assets}icon.png" alt="" width="24" height="24"><span>xunji-mcp</span></div><span class="demo-badge">${c.demoBadge}</span></div>
        <div class="demo-tabs" role="tablist" aria-label="${c.tabsLabel}">
          ${c.tabs.map((tab, index) => `<button type="button" role="tab" id="demo-tab-${index}" aria-controls="demo-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${tab}</button>`).join('')}
        </div>
        <div class="demo-body">
          ${c.tabs
            .map(
              (
                _,
                index,
              ) => `<section class="demo-panel" role="tabpanel" id="demo-panel-${index}" aria-labelledby="demo-tab-${index}" tabindex="0"${index ? ' hidden' : ''}>
            <div class="question"><span class="question-mark" aria-hidden="true">↗</span><p>${c.questions[index]}</p></div>
            <div class="answer-head"><span class="answer-mark" aria-hidden="true">${icon('chart')}</span><p>${c.answers[index]}</p></div>
            ${
              index === 0
                ? `<div class="kpis">${['48', '640', '111k'].map((value, i) => `<div><span class="kpi-label">${c.kpiLabels[i]}</span><strong>${value}${i === 2 ? '<small>kg</small>' : ''}</strong></div>`).join('')}</div><div class="chart-head"><span>${c.volume}</span><span class="chart-unit">${c.volumeUnit}</span></div>${bars([14.2, 16.8, 17.6, 19.1, 20.9, 22.4], 'k')}`
                : index === 1
                  ? `<div class="chart-head"><span>${c.consistency}</span><span class="chart-unit">${c.consistencyNote}</span></div>${bars([6, 7, 8, 8, 9, 10], '', 'consistency-chart')}`
                  : `<div class="chart-head"><span>${c.progress}</span><span class="chart-unit">kg × 5</span></div>${bars([80, 85, 85, 90, 95, 100], '', 'progress-chart')}<p class="progress-note">${c.progressNote}</p>`
            }
            <div class="coverage"><span class="status-dot"></span>${c.coverage}<code>${index === 2 ? 'xunji_movement_progress' : 'xunji_training_overview'}</code></div>
          </section>`,
            )
            .join('')}
        </div>
        <p class="demo-footer">${c.demoFooter}</p>
      </div>
    </section>
    <section id="experience" class="section shell" aria-labelledby="experience-title">
      <div class="section-intro"><p class="eyebrow">${c.experienceLabel}</p><h2 id="experience-title">${c.experienceTitle}</h2><p>${c.experienceIntro}</p></div>
      <div class="feature-grid">${c.features
        .map(
          (feature) =>
            `<article class="feature-card"><div class="feature-icon">${icon(feature.icon)}</div><p class="card-tag">${feature.tag}</p><h3>${feature.title}</h3><p>${feature.text}</p><code>${feature.tool}</code></article>`,
        )
        .join('')}</div>
    </section>
    <section id="how-it-works" class="section architecture-section" aria-labelledby="architecture-title">
      <div class="shell architecture-grid">
        <div class="section-intro"><p class="eyebrow">${c.architectureLabel}</p><h2 id="architecture-title">${c.architectureTitle[0]}<br><span>${c.architectureTitle[1]}</span></h2><p>${c.architectureIntro}</p><a class="text-link" href="${doc('architecture')}">${c.architectureLink}${icon('arrow')}</a></div>
        <div class="architecture-content">
          <div class="data-flow" role="img" aria-label="${c.flowLabel}">${c.nodes
            .map(
              (node, index) =>
                `${index ? '<span class="flow-line" aria-hidden="true"></span>' : ''}<div class="flow-node${index === 1 ? ' bridge-node' : ''}">${index === 1 ? `<img src="${assets}icon.png" width="48" height="48" alt="">` : icon(index === 0 ? 'chart' : 'grid')}<strong>${node[0]}</strong><span>${node[1]}</span></div>`,
            )
            .join('')}</div>
          <div class="security-points">${c.security.map((point, index) => `<div><span class="point-number">0${index + 1}</span><div><h3>${point[0]}</h3><p>${point[1]}</p></div></div>`).join('')}</div>
        </div>
      </div>
    </section>
    <section class="section shell benchmark" aria-labelledby="benchmark-title">
      <div class="section-intro"><p class="eyebrow">${c.benchmarkLabel}</p><h2 id="benchmark-title">${c.benchmarkTitle}</h2><p>${c.benchmarkIntro}</p></div>
      <div class="benchmark-stats">${['183', '1', '~552'].map((value, index) => `<div class="${index === 0 ? 'old-metric' : ''}"><strong>${value}</strong><span>${c.benchmarkLabels[index]}</span></div>`).join('')}</div>
      <p class="benchmark-note">${c.benchmarkNote} <a href="${doc('benchmark')}">${c.benchmarkLink}${icon('arrow')}</a></p>
    </section>
    <section id="get-started" class="section shell" aria-labelledby="start-title">
      <div class="section-intro"><p class="eyebrow">${c.startLabel}</p><h2 id="start-title">${c.startTitle}</h2><p>${c.startIntro}</p></div>
      <div class="start-grid">
        <ol class="steps">${c.steps.map((step, index) => `<li><span class="step-number">${index + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p><a class="text-link" href="${doc(step[3])}">${step[2]}${icon('arrow')}</a></div></li>`).join('')}</ol>
        <div class="terminal"><div class="terminal-top"><div class="terminal-dots" aria-hidden="true"><span></span><span></span><span></span></div><span>${c.codeLabel}</span><button type="button" class="copy-button" aria-label="${c.copyLabel}" data-copy data-copied="${c.copied}" data-failed="${c.copyFailure}">${icon('copy')}</button></div><pre><code id="setup-commands">${escape(setup)}</code></pre><div class="terminal-footer"><span>Node.js ≥ 20</span><span>Cloudflare Workers</span><span>MIT</span></div><span class="copy-status" role="status" aria-live="polite"></span></div>
      </div>
    </section>
    <section id="documentation" class="section shell documentation" aria-labelledby="docs-title">
      <div class="section-intro"><p class="eyebrow">${c.docsLabel}</p><h2 id="docs-title">${c.docsTitle}</h2><p>${c.docsIntro}</p></div>
      <div class="doc-grid">${c.docCards.map((card) => `<a class="doc-card" href="${links[card[3]]}"><h3>${card[0]}</h3><p>${card[1]}</p><span>${card[2]}${icon('arrow')}</span></a>`).join('')}</div>
      <div class="faq"><h3>${c.faqTitle}</h3><div>${c.faqs.map((faq) => `<details><summary>${faq[0]}<span aria-hidden="true">+</span></summary><p>${faq[1]}</p></details>`).join('')}</div></div>
    </section>
    <section class="closing shell"><div class="closing-icon"><img src="${assets}icon.png" width="64" height="64" alt=""></div><h2>${zh ? '让训练数据，与智能对话。' : 'Your training. A new perspective.'}</h2><a class="button button-primary" href="${doc('deployment')}">${c.primary}${icon('right')}</a></section>
  </main>
  <footer class="site-footer shell"><div><a class="brand" href="./"><img src="${assets}icon.png" width="28" height="28" alt=""><span>xunji-mcp</span></a><p>${c.footer}</p><small>${c.unaffiliated}</small></div><div class="footer-right"><nav aria-label="${zh ? '页脚导航' : 'Footer navigation'}">${[links.docs, rootDoc('PRIVACY'), rootDoc('SECURITY'), rootDoc('CONTRIBUTING')].map((href, index) => `<a href="${href}">${c.footerLinks[index]}</a>`).join('')}</nav><a href="${repo}/releases/tag/v${version}">v${version} · MIT ${icon('arrow')}</a></div></footer>
</body>
</html>
`;
}
