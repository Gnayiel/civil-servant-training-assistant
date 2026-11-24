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
}

console.log(failed ? `\n${failed} 项失败\n` : '\n工作流校验通过\n');
process.exit(failed ? 1 : 0);
