#!/usr/bin/env node
/**
 * 不依赖 git 的推送：用 GitHub REST API 一次性创建仓库并提交全部文件。
 *
 *   GITHUB_TOKEN=xxx node tools/push-to-github.mjs --owner Gnayiel [--repo 名称] [--message 提交信息] [--dry]
 *
 * 读取 .gitignore 排除目录，把工作区文件打包进一个 commit（不是逐文件提交）。
 * 适合没装 git 或不想在工作区留 .git 的场景。
 *
 * 需要的令牌权限：
 *   经典令牌 → repo（含 public_repo 即可，需能创建仓库）
 *   细粒度令牌 → Contents: Read and write，Administration: Read and write
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function arg(name, dft = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dft;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dft;
}

const OWNER = arg('owner');
const REPO = arg('repo', 'civil-servant-training-assistant');
const DRY = process.argv.includes('--dry');
const MESSAGE = arg('message');
const DESC = 'Tampermonkey 用户脚本：公务员网络培训平台通用助手，自动答题 + 解除播放失焦暂停 + 本地题库';

// 版本号只有一个事实来源：脚本元数据。写死在提交信息里迟早会和 @version 对不上。
function currentVersion() {
  try {
    const src = readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8');
    const m = /^\/\/\s*@version\s+(\S+)/m.exec(src);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

if (!OWNER) {
  console.error('用法: GITHUB_TOKEN=xxx node tools/push-to-github.mjs --owner <用户名> [--repo <仓库名>] [--message <提交信息>] [--dry]');
  process.exit(2);
}
if (!TOKEN) {
  console.error('缺少令牌：请设置环境变量 GITHUB_TOKEN');
  process.exit(2);
}

// ---------------------------------------------------------------- 收集文件
// 与 .gitignore 保持一致：这些目录不进仓库
const SKIP_DIRS = new Set(['_ref', 'probe', 'node_modules', '.git', '.tmp-smoke', '.dbg', '.tmp-output', '.Trash-0']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'package-lock.json']);

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    if (name.endsWith('.log')) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) collect(abs, out);
    else out.push(relative(ROOT, abs).split('\\').join('/'));
  }
  return out;
}

const files = collect(ROOT).sort();

// 硬性护栏：绝不能把凭证或探测现场推上去
const FORBIDDEN = [
  /^probe\//, /^_ref\//, /\.user\.js\.bak$/, /^\.env/,
];
const leaks = files.filter((f) => FORBIDDEN.some((re) => re.test(f)));
if (leaks.length) {
  console.error('拒绝推送：以下文件疑似含敏感内容\n  ' + leaks.join('\n  '));
  process.exit(1);
}

// 内容级检查：会话凭证不能进仓库
const SUSPICIOUS = [
  { re: /JSESSIONID=[A-F0-9]{16,}/, why: 'JSESSIONID' },
  { re: /\btoken=[0-9a-f]{8}-[0-9a-f]{4}-/i, why: '会话 token' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, why: 'GitHub 令牌' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: '私钥' },
];
const hits = [];
for (const f of files) {
  // 跳过图片等二进制
  if (/\.(png|jpe?g|webp|gif|ico|zip|mp4|woff2?)$/i.test(f)) continue;
  const text = readFileSync(join(ROOT, f), 'utf8');
  for (const s of SUSPICIOUS) {
    if (s.re.test(text)) hits.push(`${f} 疑似含${s.why}`);
  }
}
if (hits.length) {
  console.error('拒绝推送：内容检查未通过\n  ' + hits.join('\n  '));
  process.exit(1);
}

console.log(`待推送 ${files.length} 个文件 → ${OWNER}/${REPO}`);
if (DRY) {
  for (const f of files) console.log('  ' + f);
  console.log('\n[预演] 未发起任何请求。');
  process.exit(0);
}

// ---------------------------------------------------------------- API 封装
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiOnce(method, path, body, allow404) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'csta-push',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404 && allow404) return { ok: true, data: null };
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch { /* 原样 */ }
    return { ok: false, status: res.status, msg: `${method} ${path} → ${res.status} ${msg}` };
  }
  return { ok: true, data: text ? JSON.parse(text) : null };
}

/**
 * 新建仓库后的几秒内，Git 数据库存在复制延迟：
 * blobs 能建，但 trees / commits 偶发 404 或 409。
 * 对写操作做 4 次指数退避重试，其余错误立即抛。
 */
async function api(method, path, body, allow404 = false) {
  const RETRYABLE = new Set([404, 409, 500, 502, 503, 504]);
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await apiOnce(method, path, body, allow404);
    if (r.ok) return r.data;
    last = r;
    if (method === 'GET' || !RETRYABLE.has(r.status)) break;
    await sleep(400 * Math.pow(2, attempt));
  }
  const e = new Error(last.msg || '请求失败');
  e.status = last.status;
  throw e;
}

async function main() {
  // 1. 身份
  const me = await api('GET', '/user');
  if (me.login.toLowerCase() !== OWNER.toLowerCase()) {
    console.warn(`注意：令牌属于 ${me.login}，与 --owner ${OWNER} 不一致，将推送到 ${OWNER}/${REPO}`);
  }
  console.log(`已认证：${me.login}`);

  // 2. 仓库：存在则复用，不存在则创建
  let repo = await api('GET', `/repos/${OWNER}/${REPO}`, null, true);
  if (repo) {
    console.log(`仓库已存在：${repo.html_url}（默认分支 ${repo.default_branch}）`);
  } else {
    repo = await api('POST', '/user/repos', {
      name: REPO,
      description: DESC,
      homepage: '',
      private: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    });
    console.log(`已创建仓库：${repo.html_url}`);
  }
  const BRANCH = repo.default_branch || 'main';

  // 空仓库没有初始提交时，Git Data API 对 blobs 返回 409「Git Repository is empty」。
  // 先用 Contents API 落一个文件产生初始提交，后续才能建 blob。
  let parentSha = null;
  // 注意：空仓库在这里返回的是 409 而不是 404，两种都当作「没有分支」
  let ref = null;
  try {
    ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  } catch (e) {
    if (!/→ (404|409)/.test(e.message)) throw e;
  }
  if (ref) {
    parentSha = ref.object.sha;
  } else {
    const seedPath = 'README.md';
    const seeded = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${seedPath}`, {
      message: 'docs: 初始化仓库',
      content: readFileSync(join(ROOT, seedPath)).toString('base64'),
    });
    parentSha = seeded.commit.sha;
    console.log('空仓库已建立初始提交：' + parentSha.slice(0, 8));
  }

  // 3. 逐个上传 blob（并发 6，避免触发二级限流）
  const entries = [];
  const CONCURRENCY = 6;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const slice = files.slice(i, i + CONCURRENCY);
    const done = await Promise.all(slice.map(async (f) => {
      const buf = readFileSync(join(ROOT, f));
      const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
        content: buf.toString('base64'),
        encoding: 'base64',
      });
      return { path: f, sha: blob.sha };
    }));
    entries.push(...done);
    process.stdout.write(`\r  上传 ${entries.length}/${files.length}`);
  }
  console.log('\r  上传完成            ');

  // 4. 树 → 提交 → 引用
  //
  // GitHub 规定：用 API 创建或修改 .github/workflows/ 下的文件，令牌必须带 workflow 权限。
  // 只有 repo 权限时，建 tree 会返回 404（不是 403，GitHub 故意模糊化）。
  // 这时自动剔除工作流文件重试，并把缺口报出来，而不是整个推送失败。
  const toTree = (list) => list.map((e) => ({
    path: e.path, mode: '100644', type: 'blob', sha: e.sha,
  }));

  let tree = null;
  let skippedWorkflows = [];
  try {
    tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: toTree(entries) });
  } catch (e) {
    const isWorkflow = entries.filter((x) => x.path.startsWith('.github/workflows/'));
    if (!/→ 404/.test(e.message) || !isWorkflow.length) throw e;

    skippedWorkflows = isWorkflow.map((x) => x.path);
    const rest = entries.filter((x) => !x.path.startsWith('.github/workflows/'));
    console.warn(`令牌缺少 workflow 权限，先跳过 ${skippedWorkflows.length} 个工作流文件`);
    tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: toTree(rest) });
  }

  const ver = currentVersion();
  const msg = MESSAGE || (parentSha
    ? 'chore: 同步仓库内容'
    : `feat: 公务员网络培训助手 v${ver || '?'}（初始提交）`);
  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: msg,
    tree: tree.sha,
    ...(parentSha ? { parents: [parentSha] } : {}),
  });

  try {
    await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      sha: commit.sha, force: false,
    });
  } catch (e) {
    // 分支还不存在时改用创建
    if (!/→ 422/.test(e.message)) throw e;
    await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`, sha: commit.sha,
    });
  }

  console.log(`\n提交完成：${commit.sha.slice(0, 8)}  分支 ${BRANCH}`);
  if (skippedWorkflows.length) {
    console.log('\n未上传（令牌缺 workflow 权限）：');
    for (const f of skippedWorkflows) console.log('  ' + f);
    console.log('补法二选一：');
    console.log('  a) 重新生成经典令牌并勾选 workflow，再执行本命令一次；');
    console.log('  b) 在 GitHub 网页新建这两个文件，粘贴本地内容。');
  }
  console.log(`仓库地址：https://github.com/${OWNER}/${REPO}`);
  console.log(`提交历史：https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
  return { owner: OWNER, repo: REPO, branch: BRANCH, sha: commit.sha };
}

main().catch((e) => {
  console.error('\n推送失败：' + e.message);
  const hint = {
    401: '令牌无效或已过期',
    403: '令牌权限不足（需要 repo / Contents:write）',
    404: '用户名或仓库名不对，或令牌无权访问',
    422: '仓库已存在同名但归属不同，或分支已受保护',
  };
  const code = Number((/→ (\d{3})/.exec(e.message) || [])[1]);
  if (hint[code]) console.error('提示：' + hint[code]);
  process.exit(1);
});
