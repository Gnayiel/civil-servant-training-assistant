#!/usr/bin/env node
/**
 * 文档校验：相对链接存在、代码围栏成对、README 里的数字与数据文件一致。
 *
 *   node tools/check-docs.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', '_ref', 'probe', '.ref', '.tmp-smoke', '.tmp-output', '.tmp-docs-images', '.tmp-view', '.dbg'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const docs = walk(ROOT);
console.log(`\n[1/5] 共 ${docs.length} 份 Markdown`);
ok('包含 README.md', docs.some((p) => p.endsWith('/README.md')));
ok('包含 LICENSE', existsSync(join(ROOT, 'LICENSE')));
ok('包含 CHANGELOG.md', existsSync(join(ROOT, 'CHANGELOG.md')));
ok('包含 CONTRIBUTING.md', existsSync(join(ROOT, 'CONTRIBUTING.md')));
ok('包含 SECURITY.md', existsSync(join(ROOT, 'SECURITY.md')));
ok('包含 CODE_OF_CONDUCT.md', existsSync(join(ROOT, 'CODE_OF_CONDUCT.md')));
ok('包含 docs/ARCHITECTURE.md', existsSync(join(ROOT, 'docs', 'ARCHITECTURE.md')));
ok('包含 docs/DEVELOPMENT.md', existsSync(join(ROOT, 'docs', 'DEVELOPMENT.md')));
ok('包含 data/README.md', existsSync(join(ROOT, 'data', 'README.md')));

// ------------------------------------------------------------------ 链接
console.log('\n[2/5] 链接与围栏');
const brokenLinks = [];
const oddFences = [];
for (const file of docs) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(ROOT.length + 1);

  const fences = (text.match(/^```/gm) || []).length;
  if (fences % 2 !== 0) oddFences.push(`${rel}(${fences})`);

  const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const target = link.split('#')[0];
    if (!target) continue;
    const abs = normalize(join(dirname(file), target));
    if (!existsSync(abs)) brokenLinks.push(`${rel} -> ${link}`);
  }
}
ok('所有相对链接都能解析', brokenLinks.length === 0, brokenLinks.slice(0, 5).join(' | '));
ok('代码围栏成对', oddFences.length === 0, oddFences.join(' | '));

// ------------------------------------------------------------------ 数字一致
console.log('\n[3/5] 文档数字与数据一致');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'bank-seed.json'), 'utf8'));
const uniq = JSON.parse(readFileSync(join(ROOT, 'data', 'questions-unique.json'), 'utf8'));
const papers = JSON.parse(readFileSync(join(ROOT, 'data', 'papers-raw.json'), 'utf8'));
const courseCount = Object.keys(papers).length;
const totalQ = Object.values(papers).reduce((n, v) => n + v.questions.length, 0);

ok(`README 写明内置 ${seed.length} 条`, readme.includes(`${seed.length} 条`), `期望 ${seed.length}`);
ok(`README 写明试卷题量 ${uniq.length}`, readme.includes(`${uniq.length} 道`) || readme.includes(`${uniq.length} 题`));
ok(`README 写明课程数 ${courseCount}`, readme.includes(`${courseCount} 门`));
ok(`README 写明原始题量 ${totalQ}`, readme.includes(`${totalQ} `));
ok('README 提到脚本文件名', readme.includes('civil-servant-training-assistant.user.js'));
ok('README 有安装步骤', /Tampermonkey/i.test(readme));
ok('README 有许可证说明', /MIT/i.test(readme));

const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const version = /@version\s+(\S+)/.exec(readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8'))[1];
ok(`CHANGELOG 记录了 ${version}`, changelog.includes(version), version);


// 提示而非失败：仓库还没建时 OWNER 必然存在，不应该卡住 CI
const placeholder = [];
for (const f of ['CHANGELOG.md', '.github/ISSUE_TEMPLATE/config.yml', 'package.json']) {
  const p = join(ROOT, f);
  // 只认真实占位符形态 github.com/OWNER/ —— 也就是 init-repo 会替换掉的那个串。
  //
  // 这条判断修过两次，记下教训：
  //   1. 最初用 includes('OWNER')，命中了 .github/CODEOWNERS 文件名 → 假待办；
  //   2. 改成单词边界匹配后又命中 CHANGELOG 里描述这次修复的句子本身 → 又假待办。
  // 用「单词」做判据，永远会被文档里提到它的地方触发；判据必须是占位符本身。
  if (existsSync(p) && /github\.com\/OWNER\//.test(readFileSync(p, 'utf8'))) placeholder.push(f);
}
const js = readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8');

// ------------------------------------------------------------------ 出口清单一致
// SECURITY.md 是读者判断「这脚本会不会把我的东西传出去」的依据，
// 漏写一个目的地比写得啰嗦严重得多。曾经它就只写了「只在配置后请求 AI 接口」，
// 而实际默认模式是把题干发给百度 —— 这类漂移必须机器查，靠人记不住。
console.log('\n[4/5] 脚本声明的网络出口与 SECURITY.md 一致');
const securityDoc = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
const connectHosts = [...js.matchAll(/^\/\/\s*@connect\s+(\S+)/gm)].map((m) => m[1].trim());
ok('脚本声明了 @connect', connectHosts.length > 0);
const missingHosts = connectHosts.filter((h) => !securityDoc.includes(h));
ok(`SECURITY.md 覆盖全部 ${connectHosts.length} 个 @connect 主机`,
  missingHosts.length === 0, missingHosts.join(', '));
// 默认联不联网是最关键的一句：百度是默认模式，必须明说
ok('SECURITY.md 点明百度是默认出口', /百度/.test(securityDoc) && /默认/.test(securityDoc));

// ------------------------------------------------------------------ SITES 与 @match 对齐
// 加一个省份要在两处同时登记：SITES 里的 hosts（决定选择器/路径），
// 以及脚本头的 @match（决定脚本会不会被注入）。只加一处就是静默失效：
// 面板永远不出现，用户以为脚本坏了，日志里连一行都没有 —— 因为压根没运行。
// 这个坑没法靠人记，必须机器查。
console.log('\n[5/5] SITES 里的域名都配了 @match 与 @connect');
const matchHosts = [...js.matchAll(/^\/\/\s*@match\s+\S*?:\/\/([^/\s]+)/gm)].map((m) => m[1].trim());
// SITES 里每个 hosts 数组的字符串字面量（注释掉的示例行会带 // 前缀，需要排除）
const sitesHosts = [];
for (const line of js.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//')) continue;             // 跳过被注释掉的示例配置
  for (const m of trimmed.matchAll(/hosts:\s*\[([^\]]*)\]/g)) {
    for (const h of m[1].matchAll(/'([^']+)'/g)) {
      if (h[1].trim()) sitesHosts.push(h[1].trim());
    }
  }
}
ok(`从 SITES 读到 ${sitesHosts.length} 个域名`, sitesHosts.length > 0);
const noMatch = sitesHosts.filter((h) => !matchHosts.includes(h));
ok('每个 SITES 域名都有对应的 @match（少了就不会注入）',
  noMatch.length === 0, noMatch.join(', '));
const noConnect = sitesHosts.filter((h) => !connectHosts.includes(h));
ok('每个 SITES 域名都有对应的 @connect（少了跨域请求会被拦）',
  noConnect.length === 0, noConnect.join(', '));
// 反向也查一次：@match 写了但 SITES 里没有，会走通用适配 —— 不是错，但值得知道
const extraMatch = matchHosts.filter((h) => !sitesHosts.includes(h));
ok('没有多余的 @match 域名（多余的只会走通用探测）',
  extraMatch.length === 0, extraMatch.join(', '));

// 占位符检查的判据必须与 init-repo.mjs 一致，且不能退化成「匹配单词」——
// 这个坑踩过两次（CODEOWNERS 文件名、CHANGELOG 里描述修复的句子）。
// 只查**非注释行**：init-repo 的注释里就写着 includes('OWNER') 这个反面例子，
// 连注释一起查会让这条断言自己误报 —— 又一个「判据命中文档」的同型错误。
// 判据也不用「含 /OWNER/」这种子串匹配：源码里写的是正则字面量 \/OWNER\/，
// 子串对不上。直接看那一行用的是 .test(正则) 还是 includes(裸词)。
const initRepoLine = readFileSync(join(ROOT, 'tools', 'init-repo.mjs'), 'utf8')
  .split('\n').find((l) => !l.trim().startsWith('//') && /stale\.push\(/.test(l)) || '';
ok('init-repo.mjs 用正则判占位符，不用 includes 裸词',
  /\.test\(/.test(initRepoLine) && !/includes\(/.test(initRepoLine),
  initRepoLine.trim().slice(0, 70));
const noUpdateUrl = !/@updateURL/.test(js);
if (placeholder.length || noUpdateUrl) {
  console.log('\n待办（不阻断 CI）：');
  if (placeholder.length) {
    console.log(`  仓库地址仍是占位符：${placeholder.join('、')}`);
    console.log('  跑 node tools/init-repo.mjs --owner <你的 GitHub 用户名> 一次补齐');
  }
  if (noUpdateUrl) console.log('  脚本未配置 @updateURL，油猴不会自动检查更新（同上，一并补齐）');
}

console.log(failed ? `\n合计 ${failed} 项失败\n` : '\n文档校验通过\n');
process.exit(failed ? 1 : 0);
