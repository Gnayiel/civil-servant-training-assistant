#!/usr/bin/env node
/**
 * 工作流静态校验：确保 CI 配置引用的脚本真实存在。
 *
 *   node tools/check-workflows.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.github', 'workflows');

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
};

console.log('\n[1/2] 工作流文件');
if (!existsSync(DIR)) {
  console.log('  FAIL 缺少 .github/workflows 目录');
  process.exit(1);
}
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
ok('至少有一个工作流', files.length > 0);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const scripts = Object.keys(pkg.scripts || {});

console.log('\n[2/2] 引用的脚本与文件');
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8');
  ok(`${f} 有 name`, /^name:/m.test(text));
  ok(`${f} 有 on 触发条件`, /^on:/m.test(text));
  // 只有真的调用 node 的工作流才需要 setup-node
  if (/node\s+[\w./-]+\.mjs|node-version/.test(text)) {
    ok(`${f} 声明了 Node 版本`, /node-version/.test(text));
  }

  // 形如 run: npm run xxx / node tools/yyy.mjs
  const npmRuns = [...text.matchAll(/npm run ([\w:]+)/g)].map((m) => m[1]);
  for (const s of new Set(npmRuns)) {
    ok(`${f} 引用 npm run ${s}（package.json 中存在）`, scripts.includes(s), scripts.join(','));
  }
  const nodeRuns = [...text.matchAll(/node ([\w./-]+\.mjs)/g)].map((m) => m[1]);
  for (const p of new Set(nodeRuns)) {
    ok(`${f} 引用 ${p}（文件存在）`, existsSync(join(ROOT, p)));
  }
  ok(`${f} 没有写死 npm install 依赖`, !/npm (install|ci)\b/.test(text));
}

console.log(failed ? `\n${failed} 项失败\n` : '\n工作流校验通过\n');
process.exit(failed ? 1 : 0);
