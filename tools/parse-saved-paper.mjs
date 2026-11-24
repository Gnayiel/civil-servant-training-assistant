#!/usr/bin/env node
/**
 * 从「另存的试卷页 HTML」里解析题目，输出 JSON。
 *
 *   node tools/parse-saved-paper.mjs 保存的文件.html            # 打印题目
 *   node tools/parse-saved-paper.mjs 保存的文件.html --merge     # 合并进 questions-unique.json
 *   node tools/parse-saved-paper.mjs 保存的文件.html --with-blank  # 同时产出空答案骨架
 *
 * 只读本地文件，不联网、不涉及登录。适用于平台换课后补题：
 * 浏览器打开考试页 → Ctrl+S 存「仅HTML」→ 跑本脚本 → 人工判答案 → sync-seed.mjs。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
const MERGE = process.argv.includes('--merge');
const WITH_BLANK = process.argv.includes('--with-blank');

if (!file || file.startsWith('--')) {
  console.error('用法: node tools/parse-saved-paper.mjs <保存的试卷.html> [--merge] [--with-blank]');
  process.exit(2);
}

let html;
try {
  html = readFileSync(file, 'utf8');
} catch (e) {
  console.error('读不到文件：' + e.message);
  process.exit(2);
}

const clean = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

// 只取试卷主体，避开右侧答题卡
const start = html.indexOf('<div class="shiti">');
const end = html.indexOf('<div class="shiti_r">', start);
const body = start >= 0 ? html.slice(start, end > start ? end : undefined) : html;
if (start < 0) {
  console.error('没找到 <div class="shiti">，可能不是试卷页，或页面结构已改版');
  process.exit(1);
}

// 按 h2 分题型块；parts = [前导, 标题1, 内容1, 标题2, 内容2, ...]
const parts = body.split(/<h2>([\s\S]*?)<\/h2>/);
const questions = [];
for (let i = 1; i < parts.length - 1; i += 2) {
  const title = clean(parts[i]);
  const seg = parts[i + 1];
  const type = /多选/.test(title) ? 'multi' : (/判断/.test(title) ? 'judge' : (/单选/.test(title) ? 'single' : null));
  if (!type) continue;

  for (const chunk of seg.split('<dl class="danxuan">').slice(1)) {
    const stemRaw = /<dt>([\s\S]*?)<\/dt>/.exec(chunk);
    if (!stemRaw) continue;
    let stem = clean(stemRaw[1])
      .replace(/^[\s\d.．、]+/, '')
      .replace(/[（(]\s*\d+\s*分\s*[）)]/g, '')
      .trim();
    if (!stem) continue;

    let opts = [...chunk.matchAll(/<dd>([\s\S]*?)<\/dd>/g)]
      .map((m) => clean(m[1]).replace(/^[A-Za-z]\s*[.．、]\s*/, ''))
      .filter(Boolean);

    // 判断题没有 dd，选项在 label 里
    if (opts.length < 2) {
      opts = [...chunk.matchAll(/<label>([\s\S]*?)<\/label>/g)]
        .map((m) => clean(m[1]).replace(/^[A-Za-z]\s*[.．、]\s*/, ''))
        .filter(Boolean);
    }
    if (opts.length < 2) continue;

    const qid = (/name="[a-z]+(\d+)"/.exec(chunk) || [])[1] || '';
    questions.push({ qid, type, q: stem, opts });
  }
}

if (!questions.length) {
  console.error('解析出 0 道题，页面结构可能已改版；请对照 docs/ARCHITECTURE.md 的 DOM 层级检查');
  process.exit(1);
}

console.log(`解析出 ${questions.length} 道题`);
const byType = questions.reduce((a, q) => ((a[q.type] = (a[q.type] || 0) + 1), a), {});
console.log('题型分布：' + Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' / '));

if (MERGE) {
  const target = join(ROOT, 'data', 'questions-unique.json');
  const pool = JSON.parse(readFileSync(target, 'utf8'));
  const have = new Set(pool.map((q) => q.q));
  const added = questions.filter((q) => !have.has(q.q));
  const next = pool.concat(added.map(({ qid, type, q, opts }) => ({ qid, type, q, opts })));
  writeFileSync(target, JSON.stringify(next, null, 1) + '\n', 'utf8');
  console.log(`合并进 questions-unique.json：新增 ${added.length} 道，总量 ${next.length}`);
  if (added.length) console.log('接下来请判答案补进 data/bank-seed.json，再跑 sync-seed.mjs');
} else if (WITH_BLANK) {
  const blank = questions.map((q) => [q.type, q.q, [], []]);
  const out = join(ROOT, '.tmp-output', 'blank-seed.json');
  writeFileSync(out, JSON.stringify(blank, null, 1) + '\n', 'utf8');
  console.log(`空答案骨架已写到 ${out}，填空后合并进 data/bank-seed.json`);
} else {
  console.log(JSON.stringify(questions, null, 1));
}
