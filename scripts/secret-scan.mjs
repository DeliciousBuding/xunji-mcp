#!/usr/bin/env node
/**
 * Secret and private-deployment scanner.
 *
 * Usage:
 *   node scripts/secret-scan.mjs            # working tree
 *   node scripts/secret-scan.mjs --history  # every blob reachable from refs
 *
 * Exits 1 when a pattern matches. Matches are redacted in output.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist', 'coverage', '.wrangler-dry']);
const SKIP_FILES = new Set(['wrangler.jsonc', 'worker-configuration.d.ts', '.dev.vars', 'package-lock.json']);
const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|zip|gz|tgz)$/i;

const PATTERNS = [
  { name: 'xunji train key', re: /\bxjllm_[A-Za-z0-9]{20,}/g },
  { name: 'xunji food key', re: /\bxjfood_[A-Za-z0-9]{20,}/g },
  { name: 'xunji body key', re: /\bxjbody_[A-Za-z0-9]{20,}/g },
  { name: 'xunji template key', re: /\bxf?tpl_[A-Za-z0-9]{20,}/g },
  { name: 'legacy xunji key', re: /\bzdcot_[A-Za-z0-9]{20,}/g },
  { name: 'xunji food search key', re: /\b[a-f0-9]{32}\b(?=.{0,40}search)/gi },
  { name: 'cloudflare api token', re: /\bcfat_[A-Za-z0-9_-]{20,}/g },
  { name: 'github token', re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'aws access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'openai key', re: /\bsk-[A-Za-z0-9]{20,}/g },
  {
    name: 'private deployment domain',
    re: new RegExp('\\b[A-Za-z0-9-]+\\.' + 'delicious233' + '\\.com\\b', 'gi'),
  },
  { name: 'personal email', re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'bearer literal', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*\b/g },
];

function redact(match) {
  if (match.length <= 8) return '***';
  return `${match.slice(0, 4)}…${match.slice(-3)} (len ${match.length})`;
}

function scanText(label, text, out) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(line)) !== null) {
        out.push(`${label}:${i + 1} [${pattern.name}] ${redact(match[0])}`);
      }
    }
  }
}

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else if (!SKIP_EXT.test(entry)) files.push(path);
  }
}

function scanTree() {
  const out = [];
  const files = [];
  walk(ROOT, files);
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scanText(relative(ROOT, file), text, out);
  }
  return out;
}

function scanHistory() {
  const out = [];
  let hasGit = true;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  } catch {
    hasGit = false;
  }
  if (!hasGit) return out;

  const blobs = execFileSync('git', ['rev-list', '--objects', '--all'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 2);

  for (const [sha, name] of blobs) {
    if (SKIP_EXT.test(name)) continue;
    let text;
    try {
      text = execFileSync('git', ['cat-file', '-p', sha], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      continue;
    }
    scanText(`history:${name}`, text, out);
  }
  return out;
}

const findings = scanTree();
if (process.argv.includes('--history')) findings.push(...scanHistory());

if (findings.length > 0) {
  console.error(`secret-scan: ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log('secret-scan: clean');
