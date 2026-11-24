#!/usr/bin/env node
/**
 * 统一门禁：按顺序跑完全部检查，任一步失败即退出。
 *
 *   node tools/ci.mjs             # 无浏览器时跳过页面冒烟
 *   node tools/ci.mjs --strict    # 必须有浏览器
 *   node tools/ci.mjs --no-smoke  # 只跑静态检查与自检（CI 里单独跑冒烟）
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const NO_SMOKE = process.argv.includes('--no-smoke');

const steps = [
  ['语法检查', ['tools/check-syntax.mjs']],
  ['文档检查', ['tools/check-docs.mjs']],
  ['数据检查', ['tools/check-data.mjs']],
  ['内置自检', ['tests/selftest.mjs']],
  ['工作流检查', ['tools/check-workflows.mjs']],
];
if (!NO_SMOKE) {
  steps.push(['页面冒烟', ['tests/page-smoke.mjs'].concat(STRICT ? ['--require-browser'] : [])]);
}

let failed = 0;
const started = Date.now();
for (const [name, args] of steps) {
  console.log(`\n${'='.repeat(56)}\n${name}  node ${args.join(' ')}\n${'='.repeat(56)}`);
  try {
    execFileSync(process.execPath, args.map((a) => join(ROOT, a)), {
      cwd: ROOT, stdio: 'inherit',
    });
  } catch {
    failed++;
    console.error(`\n[失败] ${name}`);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${'='.repeat(56)}`);
console.log(failed ? `${failed}/${steps.length} 步失败，用时 ${secs}s` : `全部 ${steps.length} 步通过，用时 ${secs}s`);
process.exit(failed ? 1 : 0);
