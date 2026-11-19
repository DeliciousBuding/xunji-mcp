# Project website and visual assets

[English](website.md) · [简体中文](website.zh-CN.md) · [Documentation](README.md)

The GitHub Pages site is a public, bilingual project introduction. It contains synthetic examples and documentation links. It never connects to Xunji or a private Worker and does not collect account data.

## Source and build

| Path                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `site/content.mjs`            | Complete English and Chinese copy                    |
| `site/render.mjs`             | Shared semantic HTML template and metadata           |
| `site/styles.css`             | Responsive layout and shared visual system           |
| `site/client.js`              | Accessible demo tabs and setup-command copy          |
| `site/cover.html`             | Centered banner composition, rendered in the browser |
| `scripts/build-site.mjs`      | Dependency-free static build                         |
| `scripts/render-cover.mjs`    | Exact 1× and 2× browser screenshots                  |
| `.github/workflows/pages.yml` | GitHub Pages build and deployment                    |

```bash
npm run site:build
```

The build writes `dist/site/index.html` and `dist/site/zh/index.html`, together with local CSS, JavaScript, images, a sitemap, and robots.txt. `dist/` is gitignored. The build uses Node.js only; no server, secret, or upstream request is needed.

The site uses separate locale URLs:

- English: <https://deliciousbuding.github.io/xunji-mcp/>
- 简体中文: <https://deliciousbuding.github.io/xunji-mcp/zh/>

Language links, `lang`, canonical URLs, `hreflang`, and sharing metadata are emitted for each locale. Text remains selectable. Locally served fonts avoid remote font requests.

## Design and interaction

The visual system uses midnight graphite, a soft blue atmosphere, rounded icon tiles, and Manrope/Noto Sans SC typography. The cover places the logo and bilingual text on a central axis. The original project icon stays unchanged. Page charts and numbers are explicitly labeled synthetic.

Demo tabs support click and Left/Right/Home/End keys with the appropriate `aria-selected` state. The copy button announces success or a fallback instruction. FAQs use native `details` elements; section links, language links, and documentation remain usable without JavaScript. Motion follows `prefers-reduced-motion`.

## Image exports

| Asset                       | Actual size         | Use                                     |
| --------------------------- | ------------------- | --------------------------------------- |
| `assets/icon.png`           | 512×512             | Project and MCP icon                    |
| `assets/readme-cover.png`   | 2560×1280           | 2× horizontal README and release banner |
| `assets/social-preview.png` | 1280×640            | GitHub Social preview and Open Graph    |
| `site/cover.html`           | 1280×640 CSS canvas | Editable HTML/CSS composition           |
| `assets/fonts/*.woff2`      | Local subset fonts  | Exact cover typography and site fonts   |

README displays the 2× PNG at a maximum width of 1280 CSS pixels and lets GitHub fit it to the available column. Both banner exports use a 2:1 ratio. The browser renders the HTML/CSS at the target pixel density after the fonts and icon have loaded; the original icon is not enlarged beyond its native size.

To reproduce the PNG exports, install development dependencies and use an installed Edge browser:

```bash
npm ci
npm run cover:render
```

`playwright-core` launches the local browser headlessly, opens `site/cover.html`
from disk, waits for fonts, and captures both exports. Remote requests are blocked.
No local server, API key, or image-generation service is needed. Set
`COVER_BROWSER=chrome` to use an installed Chrome browser instead of Edge.

The committed Manrope and Noto Sans SC WOFF2 files are subsets of the open-source
fonts from [Google Fonts](https://github.com/google/fonts). Their SIL Open Font
License texts are in `assets/fonts/OFL-Manrope.txt` and
`assets/fonts/OFL-Noto-Sans-SC.txt`. The Chinese subset covers current static
site and cover copy. Expand it when adding new Chinese text; browser fallback
fonts otherwise supply missing glyphs.

## Publishing and rollback

Enable GitHub Pages with the GitHub Actions source, then push site changes to `main`. The Pages workflow uploads only `dist/site`; it never uploads the repository, deployment config, or secrets. The package version supplies the site's release links.

To roll back the site, revert the relevant source commit and let Pages publish the resulting build. A website release does not deploy the private MCP Worker. Worker deployment and rollback follow [the deployment guide](deployment.md).

GitHub Social preview is a repository setting separate from Pages. Upload `assets/social-preview.png` in repository Settings after reviewing the final asset.
