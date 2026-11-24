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
console.log(`\n[1/4] 共 ${docs.length} 份 Markdown`);
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
console.log('\n[2/4] 链接与围栏');
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
console.log('\n[3/4] 文档数字与数据一致');
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
  // 用 \bOWNER\b 而不是 includes('OWNER')：后者会命中 .github/CODEOWNERS 这个文件名，
  // 于是每次 CI 都报一条「仓库地址仍是占位符」的假待办 —— 噪音会训练人忽略这条提示。
  if (existsSync(p) && /\bOWNER\b/.test(readFileSync(p, 'utf8'))) placeholder.push(f);
}
const js = readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8');

// ------------------------------------------------------------------ 出口清单一致
// SECURITY.md 是读者判断「这脚本会不会把我的东西传出去」的依据，
// 漏写一个目的地比写得啰嗦严重得多。曾经它就只写了「只在配置后请求 AI 接口」，
// 而实际默认模式是把题干发给百度 —— 这类漂移必须机器查，靠人记不住。
console.log('\n[4/4] 脚本声明的网络出口与 SECURITY.md 一致');
const securityDoc = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
const connectHosts = [...js.matchAll(/^\/\/\s*@connect\s+(\S+)/gm)].map((m) => m[1].trim());
ok('脚本声明了 @connect', connectHosts.length > 0);
const missingHosts = connectHosts.filter((h) => !securityDoc.includes(h));
ok(`SECURITY.md 覆盖全部 ${connectHosts.length} 个 @connect 主机`,
  missingHosts.length === 0, missingHosts.join(', '));
// 默认联不联网是最关键的一句：百度是默认模式，必须明说
ok('SECURITY.md 点明百度是默认出口', /百度/.test(securityDoc) && /默认/.test(securityDoc));
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
