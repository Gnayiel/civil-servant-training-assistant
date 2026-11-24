#!/usr/bin/env node
/**
 * 发版助手：校验版本一致性，并在本地打 annotated tag（不 push）。
 *
 *   node tools/release.mjs --check-ci vX.Y.Z   # CI 用：只校验，不碰 git
 *   node tools/release.mjs --dry-run           # 离线预检：只读，不联网、不打 tag
 *   node tools/release.mjs                     # 本地发版：前置检查 → 统一门禁 → 打 tag
 *
 * 唯一联网动作是带 20 秒超时的 `git fetch --tags`（--dry-run / --check-ci 不联网）。
 * 版本号只有一个事实来源：用户脚本头部的 `// @version`。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'civil-servant-training-assistant.user.js');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const SIZE_BUDGET = 260 * 1024;

const argv = process.argv.slice(2);
const CHECK_CI = argv.includes('--check-ci');
const DRY = argv.includes('--dry-run') || CHECK_CI;
const SKIP_TESTS = argv.includes('--skip-tests');
const tagArg = (() => {
  const i = argv.indexOf('--check-ci');
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return '';
})();

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return true;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
  return false;
};
const warn = (msg) => console.log(`  warn ${msg}`);

// ---------------------------------------------------------------- 读取版本
const code = readFileSync(SCRIPT, 'utf8');
const version = (/^\/\/\s*@version\s+(\S+)/m.exec(code) || [])[1] || '';
console.log(`\n[1/5] 脚本版本`);
ok('@version 存在', !!version, version);
ok('@version 是 x.y.z 或 vx.y.z', /^v?\d+\.\d+\.\d+$/.test(version), version);
const VER = version.replace(/^v/, '');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
ok('package.json version 与 @version 一致', pkg.version === VER, `package.json=${pkg.version}`);

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const badge = /badge\/version-(v?\d+\.\d+\.\d+)-/.exec(readme);
ok('README 版本徽章与 @version 一致', badge && badge[1].replace(/^v/, '') === VER,
  badge ? badge[1] : '未找到徽章');

// ---------------------------------------------------------------- tag 与版本
console.log(`\n[2/5] tag 与 CHANGELOG`);
const TAG = tagArg || `v${VER}`;
if (tagArg) {
  ok('传入的 tag 等于 @version（含 v 前缀）', tagArg === `v${VER}`, `tag=${tagArg} 期望=v${VER}`);
} else {
  console.log(`  将使用 tag：${TAG}`);
}

// CHANGELOG 必须有 `## vX.Y.Z` 章节，且正文非空
const cl = readFileSync(CHANGELOG, 'utf8').split('\n');
const startIdx = cl.findIndex((l) => l.trim() === `## ${TAG}`);
if (startIdx < 0) {
  ok(`CHANGELOG 有 ## ${TAG} 章节`, false, '没有该标题行');
} else {
  ok(`CHANGELOG 有 ## ${TAG} 章节`, true);
  let body = [];
  for (let i = startIdx + 1; i < cl.length; i++) {
    if (/^## v/.test(cl[i])) break;
    if (/^---$/.test(cl[i])) break;
    body.push(cl[i]);
  }
  const text = body.join('\n').trim();
  ok('该章节正文非空', text.length > 0, `长度 ${text.length}`);
  // 章节里要有分类标题，避免「只有日期」的占位发布
  ok('该章节含分类（新增/变更/修复/移除/验证）',
    /^###\s*(新增|变更|修复|移除|验证)/m.test(text));
}

// ---------------------------------------------------------------- 体积
console.log(`\n[3/5] 体积`);
const bytes = statSync(SCRIPT).size;
ok(`脚本 ${(bytes / 1024).toFixed(1)} KB 在 ${SIZE_BUDGET / 1024} KB 预算内`, bytes < SIZE_BUDGET);

// ---------------------------------------------------------------- git
console.log(`\n[4/5] 仓库状态`);
let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'pipe' });
} catch {
  hasGit = false;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

if (!hasGit) {
  if (CHECK_CI) {
    // CI 里 checkout 出来的仓库一定有 git；本地没有 git 时只提示
    warn('本机没有 git，跳过仓库状态检查（CI 里会执行）');
  } else if (DRY) {
    warn('本机没有 git，--dry-run 只做文件级校验');
  } else {
    console.error('  FAIL 需要 git 才能打 tag；请安装 git 或改用 --dry-run 只做校验');
    failed++;
  }
} else {
  // 工作区干净：dry-run 只告警
  let dirty = '';
  try {
    dirty = git(['status', '--porcelain']);
  } catch (e) {
    warn('git status 失败：' + e.message);
  }
  if (dirty) {
    const msg = `工作区有未提交改动（${dirty.split('\n').length} 个文件）`;
    if (DRY) warn(msg + '，dry-run 不阻断');
    else ok('工作区干净', false, msg);
  } else {
    ok('工作区干净', true);
  }

  // 版本单调：不能小于等于已有 tag
  if (!DRY) {
    try {
      execFileSync('git', ['fetch', '--tags', '--quiet'], {
        cwd: ROOT, stdio: 'pipe', timeout: 20000,
      });
    } catch {
      warn('git fetch --tags 失败或超时（离线？），改用本地 tag 判断单调性');
    }
  }
  let tags = [];
  try {
    tags = git(['tag', '--list', 'v*']).split('\n').filter(Boolean);
  } catch { /* 没有 tag */ }
  const nums = tags
    // 排除正在发布的这个 tag：release.yml 由 tag push 触发，跑起来时它必然已存在。
    // 不排除的话「版本大于已有最高 tag」永远为假，发版工作流结构上不可能通过。
    .filter((t) => t !== TAG)
    .map((t) => t.replace(/^v/, '').split('.').map(Number))
    .filter((a) => a.length === 3 && a.every((n) => Number.isInteger(n)));
  const cur = VER.split('.').map(Number);
  const gt = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const maxTag = nums.sort(gt).pop();
  if (maxTag) {
    ok(`版本 ${VER} 大于之前的最高 tag v${maxTag.join('.')}`, gt(cur, maxTag) > 0,
      `已有 v${maxTag.join('.')}`);
  } else {
    console.log('  info 在此之前没有其他 v* tag（首个版本）');
  }

  // tag 是否已存在
  const exists = tags.includes(TAG);
  if (exists && !DRY) {
    console.log(`\n  info tag ${TAG} 已存在，无需重复打 tag。`);
    console.log('       如需重发，先删本地 tag（git tag -d）并确认远端未发布。');
    process.exit(failed ? 1 : 0);
  }
}

// ---------------------------------------------------------------- 门禁
console.log(`\n[5/5] 统一门禁`);
if (CHECK_CI) {
  console.log('  info CI 环境由 release.yml 的下一步单独跑 `node tools/ci.mjs --strict`，此处跳过');
} else if (SKIP_TESTS) {
  warn('--skip-tests：跳过门禁（仅用于本地调试，CI 仍会跑全套）');
} else if (DRY) {
  console.log('  info --dry-run 不跑门禁，请单独执行 `node tools/ci.mjs`');
} else {
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools', 'ci.mjs'), '--strict'], {
      cwd: ROOT, stdio: 'inherit',
    });
    ok('统一门禁通过', true);
  } catch {
    ok('统一门禁通过', false, '见上方输出');
  }
}

// ---------------------------------------------------------------- 汇总
console.log('');
if (failed) {
  console.error(`${failed} 项检查失败，未打 tag。`);
  process.exit(1);
}

if (DRY) {
  console.log(`校验通过：${TAG}（脚本 ${(bytes / 1024).toFixed(1)} KB）`);
  if (CHECK_CI) console.log('CI 发版门禁通过，可以创建 Release。');
  else console.log('去掉 --dry-run 才会真正打 tag。');
  process.exit(0);
}

// 打 annotated tag
try {
  execFileSync('git', ['tag', '-a', TAG, '-m', TAG], { cwd: ROOT, stdio: 'pipe' });
  console.log(`已在本地创建 annotated tag ${TAG}（未推送）。`);
  console.log(`
接下来：

  1) 先推 main（release.yml 会校验 raw main 已跟上 tag）：
       git push origin HEAD:main
  2) 再只推这一个 tag（不要 git push --tags，会带上本地遗留的旧 tag）：
       git push origin ${TAG}
`);
} catch (e) {
  console.error('打 tag 失败：' + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}
