#!/usr/bin/env node
/**
 * 外链检查：扫描文档里的 http(s) 链接，分级报告。
 *
 *   node tools/check-external-links.mjs            # 只报告，不失败（默认不进门禁）
 *   node tools/check-external-links.mjs --strict   # 有硬失败则退出 1（发版前人工复核用）
 *
 * 分级：
 *   - 硬失败：DNS 失败、连接超时、404/410、5xx
 *   - 警告：403/429（多为反爬或限流，链接本身通常有效）、跳转到其它域名
 *
 * 需要网络。默认不进入 `node tools/ci.mjs`，因为 CI 里外网可达性与反爬策略不稳定。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const TIMEOUT = 15000;
const CONCURRENCY = 6;

const SKIP_DIRS = new Set(['_ref', 'probe', 'node_modules', '.git', '.tmp-smoke', '.ref', '.dbg']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** 收集链接 → Map<url, 出现位置[]> */
const found = new Map();
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  // 行内链接与裸 URL 都收
  const urls = [
    ...[...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/<(https?:\/\/[^>\s]+)>/g)].map((m) => m[1]),
  ];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:)\]]+$/, '');
    if (!found.has(url)) found.set(url, []);
    found.get(url).push(rel);
  }
}

const urls = [...found.keys()].sort();
console.log(`\n扫描到 ${urls.length} 个外链（去重后），来自 ${walk(ROOT).length} 份 Markdown\n`);

async function check(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    // 先 HEAD；有些站点不支持 HEAD 再退回 GET
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    }
    return { url, status: res.status, finalUrl: res.url };
  } catch (e) {
    return { url, error: e.name === 'AbortError' ? '超时' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (let i = 0; i < urls.length; i += CONCURRENCY) {
  results.push(...await Promise.all(urls.slice(i, i + CONCURRENCY).map(check)));
}

const hard = [];
const soft = [];
const okList = [];

for (const r of results) {
  const where = found.get(r.url).join(', ');
  if (r.error) {
    hard.push({ ...r, why: r.error, where });
  } else if (r.status === 403 || r.status === 429) {
    soft.push({ ...r, why: `HTTP ${r.status}（反爬/限流，链接通常有效）`, where });
  } else if (r.status >= 400) {
    hard.push({ ...r, why: `HTTP ${r.status}`, where });
  } else {
    okList.push({ ...r, where });
  }
}

console.log(`可达 ${okList.length} · 警告 ${soft.length} · 硬失败 ${hard.length}\n`);

if (soft.length) {
  console.log('警告（不计失败）：');
  for (const r of soft) console.log(`  ${r.why.padEnd(34)} ${r.url}\n     出现于 ${r.where}`);
  console.log('');
}

if (hard.length) {
  console.log('失败：');
  for (const r of hard) console.log(`  ${r.why.padEnd(34)} ${r.url}\n     出现于 ${r.where}`);
  console.log('');
}

if (STRICT && hard.length) {
  console.error(`${hard.length} 个外链失败（--strict）`);
  process.exit(1);
}
if (!STRICT) {
  console.log('（默认不阻断；发版前可用 --strict 复核）');
}
process.exit(0);
