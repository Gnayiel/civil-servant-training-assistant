#!/usr/bin/env node
/**
 * 语法校验：对用户脚本与所有 .mjs 工具跑 node --check。
 *
 *   node tools/check-syntax.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '_ref', 'probe'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (name.endsWith('.mjs') || name.endsWith('.user.js')) out.push(p);
  }
  return out;
}

const files = collect(ROOT).sort();
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log(`  ok   ${f.slice(ROOT.length + 1)}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${f.slice(ROOT.length + 1)}\n${e.stderr ? e.stderr.toString() : e.message}`);
  }
}
console.log(failed ? `\n${failed} 个文件语法错误\n` : `\n${files.length} 个文件语法通过\n`);
process.exit(failed ? 1 : 0);
