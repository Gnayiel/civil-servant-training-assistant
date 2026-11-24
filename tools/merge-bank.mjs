#!/usr/bin/env node
/**
 * 合并多份题库快照：把多人判定的答案合成一份 bank-seed.json。
 *
 *   node tools/merge-bank.mjs a.json b.json --out data/bank-seed.json
 *   node tools/merge-bank.mjs a.json b.json --dry      # 只报告，不写盘
 *
 * 输入可以是任意混合格式：
 *   - 仓库格式：紧凑四元组 [题型, 题干, 答案文本[], 答案字母[]]
 *   - 面板导出：{format, schema, bank: {指纹: {q,t,a,l,...}}}
 *   - 纯数组：[{q,t,a,l}, ...]
 *
 * 冲突规则（同题干指纹不同答案）：
 *   - 双方答案一致 → 取其一，计入「一致」
 *   - 不一致 → 默认保留先出现的那份并记为冲突；加 --prefer-later 则取后者
 *   - 冲突清单始终打印，人工复核后再落盘
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, dft = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dft;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dft;
}

const DRY = process.argv.includes('--dry');
const PREFER_LATER = process.argv.includes('--prefer-later');
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx >= 0 && process.argv[outIdx + 1] && !process.argv[outIdx + 1].startsWith('--')
  ? process.argv[outIdx + 1] : '';
const files = process.argv.slice(2).filter((a, i, arr) => {
  if (a.startsWith('--')) return false;
  if (arr[i - 1] === '--out') return false;
  return true;
});

if (!files.length) {
  console.error(`用法: node tools/merge-bank.mjs <文件1> [文件2 ...] [--out data/bank-seed.json] [--dry] [--prefer-later]

  --dry           只报告，不写盘
  --prefer-later  冲突时取后出现的答案（默认保留先出现的）
  --out <路径>    输出文件；不指定则只打印统计`);
  process.exit(2);
}

// ---------------------------------------------------------------- 归一化（与脚本同源）
const storeMap = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, URL, URLSearchParams, TextEncoder, TextDecoder,
  GM_info: { script: { version: 'merge' } },
  GM_getValue: (k, d) => (storeMap.has(k) ? JSON.parse(storeMap.get(k)) : d),
  GM_setValue: (k, v) => storeMap.set(k, JSON.stringify(v)),
};
sandbox.globalThis = sandbox;
vm.runInContext(readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8'),
  vm.createContext(sandbox), { timeout: 5000 });
const { fpKey, pureStem } = sandbox.__GWX_TEST__;

// ---------------------------------------------------------------- 解析各格式
/** 把任意支持格式展开成 [{t,q,a,l}] */
function normalize(data) {
  if (Array.isArray(data)) {
    // 紧凑四元组 or 对象数组
    return data.map((e) => {
      if (Array.isArray(e)) return { t: e[0], q: e[1], a: e[2] || [], l: e[3] || [] };
      return { t: e.t, q: e.q, a: e.a || [], l: e.l || [] };
    }).filter((e) => e.q);
  }
  if (data && typeof data === 'object' && data.bank) {
    // 面板导出
    return Object.values(data.bank).map((e) => ({
      t: e.t, q: e.q, a: e.a || [], l: e.l || [],
    })).filter((e) => e.q);
  }
  throw new Error('无法识别的格式：既不是数组，也没有 bank 字段');
}

const sig = (e) => (e.a || []).join('\u0001');

// ---------------------------------------------------------------- 合并
const merged = new Map();   // fpKey -> entry
const stats = { read: 0, added: 0, dupSame: 0, conflicts: 0 };
const conflictList = [];

for (const f of files) {
  if (!existsSync(f)) {
    console.error(`跳过不存在的文件：${f}`);
    continue;
  }
  let list;
  try {
    list = normalize(JSON.parse(readFileSync(f, 'utf8')));
  } catch (e) {
    console.error(`跳过 ${f}：${e.message}`);
    continue;
  }
  console.log(`${f}  →  ${list.length} 条`);
  stats.read += list.length;

  for (const e of list) {
    const key = fpKey(e.q);
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { t: e.t, q: pureStem(e.q), a: e.a, l: e.l });
      stats.added++;
      continue;
    }
    if (sig(cur) === sig(e)) {
      stats.dupSame++;
      continue;
    }
    // 冲突
    stats.conflicts++;
    conflictList.push({
      q: cur.q.slice(0, 40),
      keep: cur.a.join('|'),
      other: (e.a || []).join('|'),
      from: f,
    });
    if (PREFER_LATER) {
      merged.set(key, { t: e.t, q: pureStem(e.q), a: e.a, l: e.l });
    }
  }
}

// ---------------------------------------------------------------- 报告
console.log(`\n读取 ${stats.read} 条 · 去重后 ${merged.size} 条 · 重复一致 ${stats.dupSame} 条 · 冲突 ${stats.conflicts} 条`);

if (conflictList.length) {
  console.log(`\n冲突明细（${PREFER_LATER ? '已取后者' : '保留先出现的那份'}）：`);
  for (const c of conflictList.slice(0, 20)) {
    console.log(`  「${c.q}…」`);
    console.log(`    保留 ${c.keep}   另一份 ${c.other}   （来自 ${c.from}）`);
  }
  if (conflictList.length > 20) console.log(`  …… 另有 ${conflictList.length - 20} 条`);
  console.log('\n**请人工复核冲突后再落盘**。同一道题不该有两个正确答案；');
  console.log('  若某一方判错了，直接修那一份快照后重跑本工具。');
}

// 按题型统计
const byType = {};
for (const e of merged.values()) byType[e.t] = (byType[e.t] || 0) + 1;
console.log(`\n题型分布：${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

if (!outPath) {
  console.log('\n未指定 --out，只报告不写盘。');
  process.exit(stats.conflicts ? 1 : 0);
}

// 输出：按题干排序，保持稳定 diff
const out = [...merged.values()]
  .sort((a, b) => a.q.localeCompare(b.q, 'zh'))
  .map((e) => [e.t, e.q, e.a, e.l]);

if (DRY) {
  console.log(`\n[预演] 将写入 ${outPath}，共 ${out.length} 条。`);
  process.exit(stats.conflicts ? 1 : 0);
}

writeFileSync(outPath, JSON.stringify(out, null, 0) + '\n', 'utf8');
console.log(`\n已写入 ${outPath}（${out.length} 条）`);
console.log('下一步：node tools/sync-seed.mjs && node tools/ci.mjs');
process.exit(stats.conflicts ? 1 : 0);
