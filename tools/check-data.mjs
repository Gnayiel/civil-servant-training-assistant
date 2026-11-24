#!/usr/bin/env node
/**
 * 题库数据校验：类型、答案合法性、与原始试卷的一致性。
 *
 *   node tools/check-data.mjs
 *
 * 只读本地 data/ 下的三份快照，不联网。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, 'data', p), 'utf8'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
};

const papers = load('papers-raw.json');
const uniq = load('questions-unique.json');
const seed = load('bank-seed.json');

// ------------------------------------------------------------------ 原始试卷
console.log('\n[1/3] papers-raw.json');
const courses = Object.entries(papers);
const totalQ = courses.reduce((n, [, v]) => n + v.questions.length, 0);
ok(`${courses.length} 门课`, courses.length > 0);
ok(`${totalQ} 道原始题`, totalQ > 0);
ok('每门课都有课程名与题目', courses.every(([, v]) => v.name && Array.isArray(v.questions)));
ok('每道题都有题干与至少两个选项',
  courses.every(([, v]) => v.questions.every((q) => q.q && q.opts.length >= 2)));

// ------------------------------------------------------------------ 去重题目
console.log('\n[2/3] questions-unique.json');
ok(`${uniq.length} 道去重题`, uniq.length > 0 && uniq.length <= totalQ);
ok('题干不重复', new Set(uniq.map((q) => q.q)).size === uniq.length);
const byType = uniq.reduce((a, q) => ((a[q.type] = (a[q.type] || 0) + 1), a), {});
ok('题型只有三种', Object.keys(byType).every((t) => ['single', 'multi', 'judge'].includes(t)),
  Object.keys(byType).join(','));
ok('三种题型都有题', byType.single > 0 && byType.multi > 0 && byType.judge > 0,
  JSON.stringify(byType));
ok('判断题恰有两个选项', uniq.filter((q) => q.type === 'judge').every((q) => q.opts.length === 2));

// ------------------------------------------------------------------ 答案
console.log('\n[3/3] bank-seed.json');
ok(`${seed.length} 条答案`, seed.length > 0);
ok('答案数不超过题目数', seed.length <= uniq.length);

const qmap = new Map(uniq.map((q) => [q.q, q]));
const badShape = seed.filter((e) => !Array.isArray(e) || e.length !== 4);
ok('结构均为四元组', badShape.length === 0, `${badShape.length} 条异常`);

const unknownQ = seed.filter((e) => !qmap.has(e[1]));
ok('题干都能对回原始试卷', unknownQ.length === 0,
  unknownQ.slice(0, 3).map((e) => e[1].slice(0, 24)).join(' | '));

const typeMismatch = seed.filter((e) => qmap.has(e[1]) && qmap.get(e[1]).type !== e[0]);
ok('题型与试卷一致', typeMismatch.length === 0,
  typeMismatch.slice(0, 3).map((e) => e[1].slice(0, 24)).join(' | '));

// 答案文本必须是该题选项之一；判断题必须是「对/错」之一
const badText = [];
for (const [t, q, a] of seed) {
  const src = qmap.get(q);
  if (!src) continue;
  const norm = (s) => String(s).replace(/\s+/g, '').replace(/[，。、；：？！“”‘’（）《》【】,.;:?!"'()<>[\]·—－-]/g, '');
  const opts = src.opts.map(norm);
  for (const ans of a) {
    if (t === 'judge') {
      if (!['对', '错'].includes(ans)) badText.push(`${q.slice(0, 16)} => ${ans}`);
    } else if (!opts.includes(norm(ans))) {
      badText.push(`${q.slice(0, 16)} => ${ans}`);
    }
  }
}
ok('答案文本都是该题的选项', badText.length === 0, badText.slice(0, 3).join(' | '));

const judgeBad = seed.filter((e) => e[0] === 'judge' && !['对', '错'].includes(e[2][0]));
ok('判断题答案是「对」或「错」', judgeBad.length === 0,
  judgeBad.slice(0, 3).map((e) => e[2][0]).join(','));

const lettersBad = seed.filter((e) => e[3].length !== e[2].length);
ok('答案字母与答案文本数量对齐', lettersBad.length === 0,
  lettersBad.slice(0, 3).map((e) => e[1].slice(0, 16)).join(' | '));

const dupQ = seed.map((e) => e[1]).filter((q, i, arr) => arr.indexOf(q) !== i);
ok('答案条目无重复', dupQ.length === 0, dupQ.slice(0, 3).join(' | '));

const coverage = ((seed.length / uniq.length) * 100).toFixed(1);
console.log(`\n题库覆盖率 ${coverage}%（${seed.length}/${uniq.length}），未收录 ${uniq.length - seed.length} 条`);
console.log(failed ? `\n合计 ${failed} 项失败\n` : '\n数据校验通过\n');
process.exit(failed ? 1 : 0);
