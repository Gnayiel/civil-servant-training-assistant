#!/usr/bin/env node
/**
 * 无依赖自检：校验 UserScript 元数据，并在 Node 里跑脚本自带的断言。
 *
 *   node tests/selftest.mjs [用户脚本路径]
 *
 * 不联网、不写盘、不需要浏览器。脚本在最小油猴 API 打桩下加载；
 * 因为脚本对「非浏览器环境」提前返回，这里跑到的就是面板「自检」
 * 按钮调用的同一批纯函数，不会碰 DOM 与存储。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SCRIPT = resolve(process.argv[2] || join(ROOT, 'civil-servant-training-assistant.user.js'));

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
};

if (!existsSync(SCRIPT)) {
  console.error(`找不到用户脚本：${SCRIPT}`);
  process.exit(1);
}
const code = readFileSync(SCRIPT, 'utf8');

// ------------------------------------------------------------------ 元数据
console.log(`\n[1/4] UserScript 元数据  ${SCRIPT}`);
const block = code.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
if (!block) {
  console.error('  FAIL 找不到 ==UserScript== 元数据块');
  process.exit(1);
}
const meta = {};
for (const line of block[1].split('\n')) {
  const m = line.match(/^\/\/\s*@([-\w:]+)\s*(.*)$/);
  if (!m) continue;
  const val = m[2].trim();
  (meta[m[1]] = meta[m[1]] || []).push(val);
}
const one = (k) => (meta[k] || [])[0] || '';
const many = (k) => (meta[k] || []).filter(Boolean);

ok('@name 存在', !!one('name'));
ok('@namespace 存在（改了会丢用户已存的题库）', !!one('namespace'));
ok('@version 是 x.y.z', /^\d+\.\d+\.\d+$/.test(one('version')), one('version'));
ok('@license 是 MIT', one('license') === 'MIT', one('license'));
ok('@description 存在', !!one('description'));
ok('@author 已填写', !!one('author') && one('author') !== 'WorkBuddy', one('author'));

// 锚定正则，而不是 includes()：后者连 "*://evil.example/?u=gwypx.gsdj.gov.cn/*" 也放过
const MATCH_OK = /^https?:\/\/gwypx\.gsdj\.gov\.cn\/\*$/;
ok(
  '@match 已限定在目标站点',
  many('match').length > 0 && many('match').every((x) => MATCH_OK.test(x)),
  many('match').join(' '),
);
ok('@noframes 已声明（避免 iframe 内重复注入）', meta.noframes !== undefined);
ok('@run-at document-idle', one('run-at') === 'document-idle', one('run-at'));

const grants = many('grant').sort();
const EXPECT_GRANTS = ['GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest'];
ok('@grant 只有实际用到的三项', JSON.stringify(grants) === JSON.stringify(EXPECT_GRANTS), grants.join(','));
ok('没有通配 @connect（供应链审查会拦）', !many('connect').includes('*'), many('connect').join(' '));
ok('@connect 覆盖目标站点', many('connect').includes('gwypx.gsdj.gov.cn'));
// 检查更新要查 Releases API 才能绕开 CDN 分支缓存，少了这条 @connect 会被拦
ok('@connect 覆盖 GitHub Releases API', many('connect').includes('api.github.com'),
  many('connect').join(' '));

// 自动更新地址必须国内可达。raw.githubusercontent.com 在中国大陆经常被阻断，
// 用它做 @updateURL 会让油猴的版本检查静默失败，用户永远收不到更新。
const updateUrl = one('updateURL');
const downloadUrl = one('downloadURL');
if (updateUrl) {
  ok('@updateURL 用 https', /^https:\/\//.test(updateUrl), updateUrl);
  ok('@updateURL 不用 raw.githubusercontent.com（国内不可达）',
    !/raw\.githubusercontent\.com/.test(updateUrl), updateUrl);
  ok('@downloadURL 与 @updateURL 一致', downloadUrl === updateUrl, downloadUrl);
}

// package.json 是版本号的第二个副本，只写不校验迟早漂移
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
ok('package.json version 与 @version 一致', pkg.version === one('version'),
  `package.json=${pkg.version} @version=${one('version')}`);

// 脚本里 GM_info 缺失时的兜底版本是第三个副本，漂了会让面板显示旧版本号
const fallback = /GM_info\.script\.version\)\s*\|\|\s*'([^']+)'/.exec(code);
ok('VERSION 兜底值与 @version 一致', !!fallback && fallback[1] === one('version'),
  fallback ? `兜底=${fallback[1]} @version=${one('version')}` : '没找到兜底写法');

// ------------------------------------------------------------------ 体积
console.log('\n[2/4] 体积与安全基线');
const bytes = statSync(SCRIPT).size;
// 260 KB：加入百度/AI 双通道答案引擎后体积上涨（引擎本身约 50 KB），
// 这个上限的作用是「防止无意间塞进大段内联数据」，不是越小越好
const BUDGET = 260 * 1024;
ok(`脚本 ${(bytes / 1024).toFixed(1)} KB 在 ${BUDGET / 1024} KB 预算内`, bytes < BUDGET);
ok('未使用 eval', !/\beval\s*\(/.test(code));
ok('未使用 new Function', !/new\s+Function\s*\(/.test(code));
ok('未使用 document.write', !/document\.write\s*\(/.test(code));
ok('未把 innerHTML 拼进动态值（只允许静态模板）',
  (code.match(/innerHTML\s*=/g) || []).length <= 2,
  `出现 ${(code.match(/innerHTML\s*=/g) || []).length} 次`);
ok('没有硬编码账号密码', !/dongyu/i.test(code) && !/820330/.test(code));
// 更新地址必须指向「最新 tag」，不能指向分支。
// 实测：main 已是 1.3.8 时 jsDelivr 的 @main 仍在返回 1.2.0（max-age 7 天、s-maxage 12 小时，
// 且分支缓存键不含查询串，加时间戳也绕不过）。用分支做 @updateURL 等于自动更新永久失效，
// 用分支做 @downloadURL 更糟 —— 用户点「重新安装」会被静默降级到旧版本。
// 只看 UserScript 头，别把正文注释里提到 @updateURL 的地方也算进来
const header = (code.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/) || [''])[0];
const urlLines = header.split('\n').filter((l) => /^\s*\/\/\s*@(?:update|download)URL/.test(l));
ok('声明了 @updateURL 与 @downloadURL', urlLines.length === 2, `${urlLines.length} 条`);
ok('更新地址用 @latest（tag），不用分支',
  urlLines.length === 2 && urlLines.every((l) => /@latest\//.test(l)),
  urlLines.map((l) => l.trim().slice(0, 90)).join(' | '));
ok('更新地址不出现分支名 @main/@master',
  !urlLines.some((l) => /@(?:main|master)\//.test(l)), '仍有分支地址');
ok('没有把 cookie/token 写进日志', !/document\.cookie/.test(code));

// ------------------------------------------------------------------ 加载
console.log('\n[3/4] 在 Node 沙箱中加载并运行内置断言');
const storeMap = new Map();
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  JSON,
  Promise,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  GM_info: { script: { version: one('version') } },
  GM_getValue: (k, d) => (storeMap.has(k) ? JSON.parse(storeMap.get(k)) : d),
  GM_setValue: (k, v) => storeMap.set(k, JSON.stringify(v)),
  GM_xmlhttpRequest: () => {
    throw new Error('自检不应发起网络请求');
  },
};
sandbox.globalThis = sandbox;
let ctx;
try {
  ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: SCRIPT, timeout: 5000 });
} catch (e) {
  console.error('  FAIL 脚本加载抛错：', e && e.message);
  process.exit(1);
}
ok('脚本在无 DOM 环境下加载不抛错', true);
const hook = ctx.__GWX_TEST__;
ok('暴露了 __GWX_TEST__', !!hook);
ok('未在加载期发起网络请求', true);

if (hook) {
  const r = hook.selfTest();
  ok(`内置断言 ${r.total} 项全部通过`, r.failed === 0,
    r.cases.filter((c) => !c.ok).map((c) => c.name).join(', '));
  for (const c of r.cases) {
    if (!c.ok) console.log(`        ${c.name}: 期望 ${JSON.stringify(c.b)} 实际 ${JSON.stringify(c.a)}`);
  }
  // 关键纯函数的额外校验
  ok('指纹区分近似题干', hook.fpKey('我国社会主要矛盾是') !== hook.fpKey('我国社会主要矛盾'));
  ok('归一化忽略全半角空格', hook.normStem('甲 乙') === hook.normStem('甲乙'));
  ok('相似度对无关文本为低值', hook.similarity('完全不同的甲题', '毫不相干的乙题') < 0.3);
}

// ------------------------------------------------------------------ 门禁清单
// tools/ci.mjs 的 ALL_STEPS 是步骤清单的唯一事实来源。
// 文档里写的「N 步」必须与它一致，否则改了门禁而文档没跟上，读文档的人会照着跑漏掉检查。
console.log('\n[4/5] 门禁步骤数与文档一致');
const ciSrc = readFileSync(join(ROOT, 'tools', 'ci.mjs'), 'utf8');
const stepNames = [...ciSrc.matchAll(/^\s*\['([^']+)',\s*\['/gm)].map((m) => m[1]);
const totalSteps = stepNames.length;
ok(`ci.mjs 定义了 ${totalSteps} 步`, totalSteps >= 5, stepNames.join(' / '));

const docClaims = [
  ['README.md', /node tools\/ci\.mjs/g],
  ['docs/DEVELOPMENT.md', new RegExp(`${totalSteps} 步|全部 ${totalSteps}`)],
  ['docs/RELEASING.md', new RegExp(`${totalSteps} 步|全部 ${totalSteps}`)],
];
// README 与 DEVELOPMENT 必须提到统一门禁命令
const readmeText = readFileSync(join(ROOT, 'README.md'), 'utf8');
ok('README 提到统一门禁命令', /node tools\/ci\.mjs/.test(readmeText));
const devText = readFileSync(join(ROOT, 'docs', 'DEVELOPMENT.md'), 'utf8');
ok('DEVELOPMENT 提到统一门禁命令', /node tools\/ci\.mjs/.test(devText));
// 只校验「与统一门禁绑定」的步数，例如「统一门禁（6 步）」。
// 宽松匹配会把 release.yml 的 7 个步骤误当成门禁步数。
const CLAIM_RES = [
  new RegExp(`(?:统一)?门禁[^。\\n]{0,12}?(\\d+)\\s*步`, 'g'),
  new RegExp(`(\\d+)\\s*步[^。\\n]{0,8}?(?:统一)?门禁`, 'g'),
];
for (const [name, text] of [['DEVELOPMENT', devText], ['RELEASING',
  readFileSync(join(ROOT, 'docs', 'RELEASING.md'), 'utf8')]]) {
  const claims = [];
  for (const re of CLAIM_RES) {
    for (const m of text.matchAll(re)) claims.push(Number(m[1]));
  }
  const bad = claims.filter((n) => n !== totalSteps);
  ok(`${name} 里与门禁绑定的步数都是 ${totalSteps}`,
    bad.length === 0, bad.length ? `出现了 ${[...new Set(bad)].join(',')}` : '');
}

// ------------------------------------------------------------------ 题库
console.log(`\n[5/5] 内置题库`);
const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'bank-seed.json'), 'utf8'));
const rawInScript = code.match(/const SEED_RAW = (\[[\s\S]*?\]);\n/);
ok('脚本内含 SEED_RAW', !!rawInScript);
if (rawInScript) {
  const embedded = JSON.parse(rawInScript[1]);
  ok(`脚本内 ${embedded.length} 条与 data/bank-seed.json 完全一致`,
    JSON.stringify(embedded) === JSON.stringify(seed),
    `脚本 ${embedded.length} 条 / 文件 ${seed.length} 条`);
}
ok(`${seed.length} 条均为 [题型,题干,答案,字母] 四元组`,
  seed.every((e) => Array.isArray(e) && e.length === 4));
ok('题型取值合法', seed.every((e) => ['single', 'multi', 'judge'].includes(e[0])));
ok('答案非空', seed.every((e) => e[2].length > 0));
ok('题干无重复', new Set(seed.map((e) => e[1])).size === seed.length);
const qs = JSON.parse(readFileSync(join(ROOT, 'data', 'questions-unique.json'), 'utf8'));
const qset = new Map(qs.map((q) => [q.q, q]));
ok('题库题干全部来自抓取到的试卷', seed.every((e) => qset.has(e[1])),
  seed.filter((e) => !qset.has(e[1])).slice(0, 3).map((e) => e[1].slice(0, 20)).join(' | '));
ok('单选只给一个答案', seed.filter((e) => e[0] === 'single').every((e) => e[2].length === 1));
ok('多选至少两个答案', seed.filter((e) => e[0] === 'multi').every((e) => e[2].length >= 2));

console.log(failed ? `\n合计 ${failed} 项失败\n` : '\n全部通过\n');
process.exit(failed ? 1 : 0);
