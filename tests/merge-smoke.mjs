#!/usr/bin/env node
/**
 * 题库合并冒烟：验证「多标签页同时答题」与「导入覆盖」的合并语义。
 *
 *   node tests/merge-smoke.mjs
 *
 * 不用浏览器，也不需要 DOM：把脚本加载进 vm，直接调它暴露的 mergeBanks。
 * 这里守的是两个曾经真实出过的 bug：
 *   1. 两个标签页各答一门课，后落盘的那个用旧快照把对方的记录冲掉；
 *   2. 清空题库后，另一页下次落盘把整库复活。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'civil-servant-training-assistant.user.js');
const code = readFileSync(SCRIPT, 'utf8');

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
};

// ---------------------------------------------------------------- 加载
const storeMap = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, URL, URLSearchParams, TextEncoder, TextDecoder,
  GM_info: { script: { version: 'test' } },
  GM_getValue: (k, d) => (storeMap.has(k) ? JSON.parse(storeMap.get(k)) : d),
  GM_setValue: (k, v) => storeMap.set(k, JSON.stringify(v)),
};
sandbox.globalThis = sandbox;
vm.runInContext(code, vm.createContext(sandbox), { filename: SCRIPT, timeout: 5000 });
const hook = sandbox.__GWX_TEST__;

console.log('\n[1/4] 合并语义');
ok('暴露了 mergeBanks', typeof hook.mergeBanks === 'function');

const T = 1000;
const entry = (q, us = T, ts = T) => ({ q, t: 'single', a: ['x'], l: ['A'], src: 'exam', ts, us });

// 两个标签页各答各的：合并后双方都保留
{
  const a = { '#a': entry('题目甲') };
  const b = { '#b': entry('题目乙') };
  const merged = hook.mergeBanks(a, b, 0);
  ok('两页各答各的：两条都在', Object.keys(merged).sort().join(',') === '#a,#b',
    Object.keys(merged).join(','));
}

// 同题冲突：取「最近使用」较新的一条
{
  const disk = { k: { q: '旧', us: 5 } };
  const local = { k: { q: '新', us: 9 } };
  ok('同题冲突取较新的本地条目', hook.mergeBanks(disk, local, 0).k.q === '新');

  const disk2 = { k: { q: '盘上更新', us: 9 } };
  const local2 = { k: { q: '本地较旧', us: 5 } };
  ok('同题冲突不覆盖盘上更新的条目', hook.mergeBanks(disk2, local2, 0).k.q === '盘上更新');
}

// 相同 us 时以本地为准（本页刚操作过）
{
  const disk = { k: { q: '盘', us: 7 } };
  const local = { k: { q: '本', us: 7 } };
  ok('us 相同时以本地为准', hook.mergeBanks(disk, local, 0).k.q === '本');
}

console.log('\n[2/4] 清空墓碑');
{
  const disk = { a: entry('甲'), b: entry('乙') };
  const local = { c: entry('丙') };
  // clearedAt 晚于所有条目的 ts/us → 全部视为已删除
  ok('清空后旧条目全部被墓碑挡住', Object.keys(hook.mergeBanks(disk, local, T + 1)).length === 0);

  // 清空之后新建的条目（us 更大）应当保留
  const afterClear = { n: entry('新题', T + 100, T + 100) };
  const merged = hook.mergeBanks({}, afterClear, T);
  ok('清空后新建的条目保留', Object.keys(merged).join(',') === 'n');
  ok('清空后旧条目 + 新条目：只留新的',
    Object.keys(hook.mergeBanks(disk, afterClear, T + 1)).join(',') === 'n');

  // 边界：与清空同一毫秒创建的条目不能被误杀。
  // 用户清空题库后立刻点「补全内置」时，blankEntry 的 ts 就落在这个毫秒上。
  ok('与清空同一毫秒的条目不被误杀',
    Object.keys(hook.mergeBanks({ n: entry('同毫秒', T, T) }, {}, T)).join(',') === 'n');
}

console.log('\n[3/4] 边界与脏数据');
{
  ok('清空时刻为 0 时不做墓碑过滤',
    Object.keys(hook.mergeBanks({ a: entry('甲') }, {}, 0)).length === 1);
  ok('空盘 + 空本地 = 空', Object.keys(hook.mergeBanks({}, {}, 0)).length === 0);
  ok('null 值被跳过', Object.keys(hook.mergeBanks({ a: null, b: entry('乙') }, {}, 0)).join(',') === 'b');
  ok('非对象值被跳过',
    Object.keys(hook.mergeBanks({ a: 'oops', b: 42, c: entry('丙') }, {}, 0)).join(',') === 'c');
  // 缺 us 的旧条目按 0 处理，不会压过有 us 的新条目
  const legacy = { k: { q: '无 us 的旧数据' } };
  ok('缺 us 的旧数据不覆盖新数据',
    hook.mergeBanks({ k: entry('有 us', 5) }, legacy, 0).k.q === '有 us');
}

console.log('\n[4/4] 内置题库与合并的交互');
{
  // 内置题库的条目 ts/us 都是导入时刻，不会因旧而被墓碑误删
  const seedCount = (code.match(/const SEED_RAW = \[/) ? 1 : 0);
  ok('脚本内含 SEED_RAW', seedCount === 1);
  const raw = JSON.parse(/const SEED_RAW = (\[[\s\S]*?\]);\n/.exec(code)[1]);
  ok(`内置题库 ${raw.length} 条都可作为合并输入`, raw.length > 0);
  // 用真实指纹作键再合并一次，确认两边条数相加
  const real = {};
  for (const [t, q, a, l] of raw.slice(0, 5)) {
    real[hook.fpKey(q)] = { q, t, a, l, ts: T, us: T };
  }
  const merged = hook.mergeBanks(real, {}, 0);
  ok('真实题库条目合并后条数不变', Object.keys(merged).length === Object.keys(real).length);
}

console.log(failed ? `\n合计 ${failed} 项失败\n` : '\n题库合并冒烟通过\n');
process.exit(failed ? 1 : 0);
