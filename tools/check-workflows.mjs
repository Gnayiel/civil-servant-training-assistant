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
  // 只从 run: 行取命令，避免把注释里的举例当成真实调用
  const runLines = [...text.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => m[1]).join('\n');
  const npmRuns = [...runLines.matchAll(/npm run ([\w:]+)/g)].map((m) => m[1]);
  for (const s of new Set(npmRuns)) {
    ok(`${f} 引用 npm run ${s}（package.json 中存在）`, scripts.includes(s), scripts.join(','));
  }
  const nodeRuns = [...runLines.matchAll(/node ([\w./-]+\.mjs)/g)].map((m) => m[1]);
  for (const p of new Set(nodeRuns)) {
    ok(`${f} 引用 ${p}（文件存在）`, existsSync(join(ROOT, p)));
  }
  ok(`${f} 没有写死 npm install 依赖`, !/npm (install|ci)\b/.test(text));

  // 第三方 action 必须 pin 到 40 位 commit SHA，不能用 @v4 这类可变标签：
  // 标签可以被上游移动，等于让第三方随时改你 CI 里跑的代码。
  const usesLines = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  const unpinned = usesLines.filter((u) => !/^[^@]+@[0-9a-f]{40}$/.test(u));
  ok(`${f} 的 action 全部 pin 到 commit SHA`, unpinned.length === 0,
    unpinned.join(', '));

  // 每个 workflow 都要显式声明 permissions，避免继承仓库默认的宽权限
  ok(`${f} 显式声明 permissions`, /^permissions:/m.test(text));

  // 不要用 pull_request_target：它会带着写权限去检出外部 PR 的代码
  ok(`${f} 不用 pull_request_target`, !/pull_request_target/.test(text));

  // 体积预算只能有 package.json 一个来源。
  // release.yml 里曾硬编码「预算 200 KB」，而实际是 270 —— 于是每一版 Release 说明
  // 都写着「脚本体积：264.5 KB（预算 200 KB）」，看起来像发版超了自身上限。
  // 这种「数字写死在别处」的问题在体积预算上已经踩过两次（selftest / release.mjs），
  // 一次在 workflow 里不会自己暴露（本地跑不到它），只能靠这条检查守。
  //
  // 只查非注释行。这条检查第一版连注释一起扫，结果命中了本文件里
  // 「曾硬编码预算 200 KB」这句说明本身而误报 —— 同一个「判据命中文档」的坑，
  // 本项目已经踩到第四次。凡是拿字面量做判据，必须先把注释排除掉。
  const codeLines = text.split('\n')
    .filter((l) => !/^\s*#/.test(l))                       // YAML / shell 注释
    .filter((l) => !/^\s*\/\//.test(l))                   // 行首 //
    .join('\n');
  const budgetLiterals = [...codeLines.matchAll(/预算\s*(\d+)\s*KB/g)].map((m) => m[1]);
  ok(`${f} 不硬编码体积预算（改用 package.json 的 sizeBudgetKB）`,
    budgetLiterals.length === 0, budgetLiterals.map((n) => `预算 ${n} KB`).join(', '));
}

console.log(failed ? `\n${failed} 项失败\n` : '\n工作流校验通过\n');
process.exit(failed ? 1 : 0);
