#!/usr/bin/env node
/** Build both static locales. No dependencies, credentials, or upstream requests. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { renderPage, siteUrl } from '../site/render.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist/site');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

await mkdir(resolve(out, 'zh'), { recursive: true });
await mkdir(resolve(out, 'assets'), { recursive: true });
await writeFile(resolve(out, 'index.html'), renderPage('en', version));
await writeFile(resolve(out, 'zh/index.html'), renderPage('zh', version));
await cp(resolve(root, 'site/styles.css'), resolve(out, 'styles.css'));
await cp(resolve(root, 'site/client.js'), resolve(out, 'client.js'));
for (const asset of ['icon.png', 'social-preview.png']) {
  await cp(resolve(root, 'assets', asset), resolve(out, 'assets', asset));
}
await cp(resolve(root, 'assets/fonts'), resolve(out, 'assets/fonts'), { recursive: true });
await writeFile(resolve(out, '.nojekyll'), '');
await writeFile(
  resolve(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}/</loc></url>
  <url><loc>${siteUrl}/zh/</loc></url>
</urlset>
`,
);
await writeFile(
  resolve(out, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
);
console.log(`Built English and 简体中文 pages in ${out}`);
