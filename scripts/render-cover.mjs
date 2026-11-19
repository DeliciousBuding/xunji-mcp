#!/usr/bin/env node
/** Capture the exact HTML composition at 1× and 2×. No remote requests or server. */
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const channel = process.env.COVER_BROWSER || 'msedge';
const browser = await chromium.launch({ channel, headless: true });

try {
  for (const [name, scale] of [
    ['readme-cover.png', 2],
    ['social-preview.png', 1],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 640 },
      deviceScaleFactor: scale,
      reducedMotion: 'reduce',
    });
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith('file:') || url.startsWith('data:') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(resolve(root, 'site/cover.html')).href);
    await page.evaluate(() => document.fonts.ready);
    const ready = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      brokenImages: [...document.images].some((image) => !image.complete || !image.naturalWidth),
      fonts:
        document.fonts.check('650 91px Manrope') &&
        document.fonts.check('450 29px "Noto Sans SC"', '让训练数据，与智能对话。'),
    }));
    if (
      ready.width !== 1280 ||
      ready.height !== 640 ||
      ready.brokenImages ||
      !ready.fonts ||
      errors.length
    ) {
      throw new Error(`Cover layout is incomplete: ${JSON.stringify({ ...ready, errors })}`);
    }
    const destination = resolve(root, 'assets', name);
    await page.screenshot({ path: destination, type: 'png', scale: 'device' });
    const png = await readFile(destination);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width !== 1280 * scale || height !== 640 * scale) {
      throw new Error(`Unexpected export size: ${name} ${width}×${height}`);
    }
    console.log(`${name}: ${width}×${height}, ${png.length} bytes`);
    await context.close();
  }
} finally {
  await browser.close();
}
