#!/usr/bin/env node
/**
 * 把 data/bank-seed.json 同步进用户脚本的 SEED_RAW。
 *
 *   node tools/sync-seed.mjs [--check]
 *
 * --check 只比较不写入，供 CI 使用（实际一致性检查在 tests/selftest.mjs 里）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'civil-servant-training-assistant.user.js');
const CHECK = process.argv.includes('--check');

const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'bank-seed.json'), 'utf8'));
// 转义 </ 以免在 HTML 上下文中提前闭合标签（油猴不解析，但导出成书签时会）
const literal = JSON.stringify(seed, null, 0).replace(/<\//g, '<\\/');

let src = readFileSync(SCRIPT, 'utf8');
const re = /const SEED_RAW = (\[[\s\S]*?\]);\n/;
const m = re.exec(src);
if (!m) {
  console.error('脚本里找不到 `const SEED_RAW = [...];`');
  process.exit(1);
}

if (CHECK) {
  const same = m[1] === literal;
  console.log(same
    ? `已一致（${seed.length} 条）`
    : `不一致：脚本 ${JSON.parse(m[1]).length} 条 / 文件 ${seed.length} 条`);
  process.exit(same ? 0 : 1);
}

src = src.replace(re, `const SEED_RAW = ${literal};\n`);
src = src.replace(/此处收录 \d+ 条高置信答案/, `此处收录 ${seed.length} 条高置信答案`);
writeFileSync(SCRIPT, src, 'utf8');
console.log(`已同步 ${seed.length} 条到脚本`);
