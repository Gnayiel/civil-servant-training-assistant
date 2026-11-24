#!/usr/bin/env node
/**
 * 仓库初始化：把占位符换成真实仓库地址，并给脚本补上自动更新地址。
 *
 *   node tools/init-repo.mjs --owner <GitHub 用户名> [--repo <仓库名>] [--dry]
 *
 * 会改动：
 *   - CHANGELOG.md 的 compare / releases 链接
 *   - .github/ISSUE_TEMPLATE/config.yml 的文档链接
 *   - package.json 的 repository / homepage / bugs
 *   - 用户脚本头部的 @updateURL / @downloadURL
 *
 * 幂等：重复执行只会补齐仍缺失的部分。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, dft = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dft;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dft;
}

const OWNER = arg('owner');
const REPO = arg('repo', 'civil-servant-training-assistant');
const DRY = process.argv.includes('--dry');

if (!OWNER) {
  console.error(`用法: node tools/init-repo.mjs --owner <GitHub 用户名> [--repo <仓库名>] [--dry]

  例: node tools/init-repo.mjs --owner zhangsan
      node tools/init-repo.mjs --owner zhangsan --repo gansu-gwypx-assistant

  不加参数时只列出当前的占位符状态。`);
  // 无参数时给出诊断，方便先看还差什么
  const stale = [];
  for (const f of ['CHANGELOG.md', '.github/ISSUE_TEMPLATE/config.yml', 'package.json']) {
    const p = join(ROOT, f);
    if (existsSync(p) && readFileSync(p, 'utf8').includes('OWNER')) stale.push(f);
  }
  const js = readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8');
  const hasUpdate = /@updateURL/.test(js);
  console.log(`\n待替换 OWNER 的文件：${stale.length ? stale.join('、') : '无'}`);
  console.log(`脚本自动更新地址：${hasUpdate ? '已配置' : '未配置'}`);
  process.exit(2);
}

if (!/^[\w.-]+$/.test(OWNER)) {
  console.error('owner 只能含字母、数字、连字符、下划线和点');
  process.exit(2);
}
if (!/^[\w.-]+$/.test(REPO)) {
  console.error('repo 只能含字母、数字、连字符、下划线和点');
  process.exit(2);
}

const SLUG = `${OWNER}/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${SLUG}/main/civil-servant-training-assistant.user.js`;
const changes = [];

function edit(file, fn) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return;
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) return;
  changes.push(file);
  if (!DRY) writeFileSync(p, after, 'utf8');
}

// ---------------------------------------------------------------- 文档与配置
edit('CHANGELOG.md', (s) => s.replace(/github\.com\/OWNER\//g, `github.com/${OWNER}/`));

edit('.github/ISSUE_TEMPLATE/config.yml', (s) =>
  s.replace(/github\.com\/OWNER\//g, `github.com/${OWNER}/`));

edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  pkg.repository = { type: 'git', url: `git+https://github.com/${SLUG}.git` };
  pkg.homepage = `https://github.com/${SLUG}#readme`;
  pkg.bugs = { url: `https://github.com/${SLUG}/issues` };
  pkg.author = OWNER;
  // 保持原有键顺序：把新键插在 author 之后，不整体重排
  return JSON.stringify(pkg, null, 2) + '\n';
});

// 顺带把文档里的 <owner>/<repo> 说明替换成实际地址，避免读者困惑
edit('docs/DEVELOPMENT.md', (s) =>
  s.replace(/https:\/\/raw\.githubusercontent\.com\/<owner>\/<repo>\/main\/civil-servant-training-assistant.user.js/g, RAW)
    .replace(/git tag v1\.0\.0 && git push --tags/, 'git tag v1.0.0 && git push --tags'));

// ---------------------------------------------------------------- 脚本头
edit('civil-servant-training-assistant.user.js', (s) => {
  const lines = s.split('\n').filter((l) => !/^\/\/\s*@(updateURL|downloadURL)\s/.test(l));
  const end = lines.findIndex((l) => l.trim() === '// ==/UserScript==');
  if (end < 0) {
    console.error('找不到元数据块结尾，未改动脚本头');
    return s;
  }
  // 先删后插：换了仓库名重跑时地址会被纠正，而不是留在旧值上
  lines.splice(end, 0, `// @updateURL    ${RAW}`, `// @downloadURL  ${RAW}`);
  return lines.join('\n');
});

// ---------------------------------------------------------------- 汇总
if (!changes.length) {
  console.log(`\n已是 ${SLUG} 的配置，无需改动。`);
} else {
  console.log(`\n${DRY ? '[预演] 将' : '已'}更新 ${SLUG}：`);
  for (const f of changes) console.log('  - ' + f);
}

if (DRY) {
  console.log('\n去掉 --dry 才会真正写入。');
  process.exit(0);
}

console.log(`
接下来（按顺序）：

  1. node tools/ci.mjs                       # 确认改动没破坏任何检查
  2. git init && git add -A && git commit -m "chore: 初始化仓库"
  3. git remote add origin git@github.com:${SLUG}.git
  4. git push -u origin main
  5. git tag v1.0.0 && git push --tags       # 触发 release.yml 发布

仓库建好后记得在 GitHub 上：
  - About 里填描述与话题（tampermonkey、userscript、automation）
  - Settings → Branches 给 main 加保护，要求 CI 通过
`);
