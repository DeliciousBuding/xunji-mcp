#!/usr/bin/env node
/** Runs the synthetic benchmark and prints its JSON result. */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const result = spawnSync(
  process.execPath,
  [
    './node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'bench/vitest.config.ts',
    '--reporter=./bench/reporter.mjs',
  ],
  { stdio: 'inherit', env: { ...process.env, BENCH_DAYS: process.argv[2] ?? '365' } },
);

if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync('bench/latest.log')) {
  console.error('benchmark produced no log');
  process.exit(1);
}
const line = readFileSync('bench/latest.log', 'utf8')
  .split('\n')
  .find((entry) => entry.startsWith('BENCH_RESULT '));
if (!line) {
  console.error('benchmark marker missing');
  process.exit(1);
}
console.log(JSON.stringify(JSON.parse(line.slice('BENCH_RESULT '.length)), null, 2));
