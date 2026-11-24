#!/usr/bin/env node
/**
 * 页面冒烟测试：用真实结构的离线 fixture 验证「解析 → 填答」与「失焦解锁」。
 *
 *   node tests/page-smoke.mjs [--require-browser]
 *
 * 不联网、不需要登录。做法是把 fixture + 用户脚本 + 断言探针拼成临时页面，
 * 交给 headless Chrome 跑完再把结果从 DOM 里读回来。
 * 找不到浏览器时默认跳过（CI 里用 --require-browser 强制失败）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TMP = join(ROOT, '.tmp-smoke');
const REQUIRE = process.argv.includes('--require-browser');
const SCRIPT = readFileSync(join(ROOT, 'civil-servant-training-assistant.user.js'), 'utf8');

const CANDIDATES = [
  process.env.CHROME_BIN,
  '/home/abc/.cache/chsarm/chrome-headless-shell-linux-arm64/chrome-headless-shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const p of CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  for (const name of ['chrome-headless-shell', 'chromium', 'google-chrome', 'chrome']) {
    try {
      const p = execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
      if (p) return p;
    } catch { /* 继续找下一个 */ }
  }
  return null;
}

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${extra ? `  -> ${extra}` : ''}`);
};

const browser = findBrowser();
if (!browser) {
  console.log('未找到 Chromium/Chrome，跳过页面冒烟测试（加 --require-browser 可强制失败）');
  process.exit(REQUIRE ? 1 : 0);
}
console.log(`浏览器：${browser}`);

const STUB = `<script>
window.GM_getValue = function (k, d) {
  var v = localStorage.getItem(k);
  return v === null ? d : JSON.parse(v);
};
window.GM_setValue = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };
window.GM_xmlhttpRequest = function () { throw new Error('冒烟测试不应联网'); };
window.GM_info = { script: { version: 'test' } };
window.__pageErrors = [];
window.addEventListener('error', function (e) { if (e && e.message) window.__pageErrors.push(String(e.message)); }, true);
</script>`;

function build(fixture, probe, budgetMs, fakePath) {
  const html = readFileSync(join(HERE, 'fixtures', fixture), 'utf8');
  return html
    .replace('</head>', `${STUB}</head>`)
    .replace('</body>', `<pre id="__r"></pre>
<script>${SCRIPT}</script>
<script>${probe}</script>
</body>`)
    .replace('</html>', `<!-- fake ${fakePath || '/'} budget ${budgetMs} --></html>`);
}

function run(html, budgetMs, fakePath = '') {
  mkdirSync(join(TMP, fakePath), { recursive: true });
  const page = join(TMP, fakePath, `p-${Date.now()}.html`);
  writeFileSync(page, html, 'utf8');
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--virtual-time-budget=' + budgetMs, '--dump-dom', 'file://' + page,
  ];
  const out = execFileSync(browser, args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  // 成功就删临时页；失败时保留，方便查看探针为何没跑起来
  if (/<pre id="__r">[\s\S]*?\S[\s\S]*?<\/pre>/.test(out)) rmSync(page, { force: true });
  else console.error('探针未回传结果，保留页面：' + page);
  const m = out.match(/<pre id="__r">([\s\S]*?)<\/pre>/);
  if (!m) {
    // 把页面上的报错信息带出来，避免只看到「没回传结果」
    const errs = [...out.matchAll(/"([^"]*Error[^"]*)"/g)].map((x) => x[1]).slice(0, 4);
    throw new Error('页面没有回传结果。浏览器报错：' + (errs.join(' | ') || '无'));
  }
  if (!m[1].trim()) throw new Error('探针脚本未执行（<pre> 为空），检查控制台报错');
  const json = m[1]
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(json);
}

// ------------------------------------------------------------------ 试卷页
console.log('\n[1/2] 试卷页：解析与填答');
const examProbe = `
setTimeout(function () {
  var r = { at: Date.now() };
  var host = document.getElementById('csta-panel-host');
  r.panel = !!host;
  r.shadow = !!(host && host.shadowRoot);
  if (host && host.shadowRoot) {
    var q = function (s) { var el = host.shadowRoot.querySelector(s); return el ? el.textContent : null; };
    r.state = q('[data-el="state"]');
    r.bankCnt = q('[data-el="bankCnt"]');
    r.examCnt = q('[data-el="examCnt"]');
  }
  var parsed = window.__GWX_TEST__ ? window.__GWX_TEST__.parseExam() : [];
  r.parsed = parsed.map(function (q) {
    return { qid: q.qid, type: q.type, stem: q.stem.slice(0, 30), n: q.options.length };
  });
  r.checked = {};
  document.querySelectorAll('.xuxiang input').forEach(function (i) {
    if (i.checked) (r.checked[i.name] = r.checked[i.name] || []).push(i.value);
  });
  // 多选残留：把答案从 ABCD 改成 AB，D 必须被取消勾选
  var multi = parsed.filter(function (q) { return q.type === 'multi'; })[0];
  if (multi) {
    var qs2 = window.__GWX_TEST__.parseExam();
    var m2 = qs2.filter(function (q) { return q.type === 'multi'; })[0];
    window.__GWX_TEST__.applyAnswer(m2, m2.options.slice(0, 2));
    r.afterNarrow = (document.getElementsByName(m2.name)[0]
      ? Array.prototype.filter.call(document.getElementsByName(m2.name), function (i) { return i.checked; })
        .map(function (i) { return i.value; })
      : []);
  }
  // 开关是按钮而非勾选框：点击切换，并落到存储
  if (host && host.shadowRoot) {
    var cb = host.shadowRoot.querySelector('[data-opt="autoSubmit"]');
    r.toggleIsButton = !!cb && cb.tagName === 'BUTTON';
    r.toggleTextBefore = cb ? cb.textContent : null;
    if (cb) cb.click();
    r.toggleTextAfter = cb ? cb.textContent : null;
    r.togglePressed = cb ? cb.getAttribute('aria-pressed') : null;
    r.savedAutoSubmit = localStorage.getItem('gwx_cfg_autoSubmit');
    // 面板里不应再出现勾选框
    r.checkboxes = host.shadowRoot.querySelectorAll('input[type=checkbox]').length;
    r.toggleCount = host.shadowRoot.querySelectorAll('button.tog').length;
    r.siteLabel = host.shadowRoot.querySelector('[data-el="site"]')
      ? host.shadowRoot.querySelector('[data-el="site"]').textContent : null;
    r.title = host.shadowRoot.querySelector('.hd b').textContent;
  }
  // 诊断包结构（脱敏细节由 Node 自检精确覆盖，这里不看正则）
  (function () {
    var d = window.__GWX_TEST__.buildDiagnostics();
    r.diagFormat = d.format;
    r.diagPageType = d.page.type;
    r.diagUrlHasQuery = d.page.url.indexOf('?') !== -1;
    r.diagLogs = (d.logs || []).length;
    r.diagSelectors = Object.keys(d.selectors || {}).length;
    r.diagBank = d.counts.bank;
    r.diagHasKeyFlag = typeof d.config.hasKey === 'boolean';
  })();
  r.selfTest = window.__GWX_TEST__.selfTest();
  r.errors = window.__pageErrors;
  document.getElementById('__r').textContent = JSON.stringify(r);
}, 9000);
`;

const exam = run(build('exam-paper.html', examProbe, 16000), 16000);
ok('面板已挂载', exam.panel && exam.shadow);
ok('页面无 JS 报错', exam.errors.length === 0, exam.errors.join(' | '));
ok('内置自检零失败', exam.selfTest && exam.selfTest.failed === 0,
  exam.selfTest ? `${exam.selfTest.failed}/${exam.selfTest.total}` : '未运行');
ok('解析出 5 道题', exam.parsed.length === 5, String(exam.parsed.length));
ok('题型判定正确：单选 2 / 多选 1 / 判断 2',
  JSON.stringify(exam.parsed.map((q) => q.type)) === JSON.stringify(['single', 'single', 'multi', 'judge', 'judge']),
  exam.parsed.map((q) => q.type).join(','));
ok('题目唯一标识取自 name 中的数字',
  JSON.stringify(exam.parsed.map((q) => q.qid)) === JSON.stringify(['9163', '9164', '9165', '9166', '9167']),
  exam.parsed.map((q) => q.qid).join(','));
ok('多选题的选项全部取到（dl 类名同为 danxuan 时仍按控件判定）',
  exam.parsed[2].n === 4, String(exam.parsed[2].n));
ok('判断题归一为两个选项', exam.parsed[3].n === 2 && exam.parsed[4].n === 2);

// 期望值来自内置题库：单选 C/B，多选 ABCD，判断 对(1)/错(0)
const EXPECT = {
  danxuan9163: ['C'],
  danxuan9164: ['B'],
  duoxuan9165: ['A', 'B', 'C', 'D'],
  panduan9166: ['1'],
  panduan9167: ['0'],
};
for (const [name, want] of Object.entries(EXPECT)) {
  const got = (exam.checked[name] || []).slice().sort();
  ok(`${name} 填入 ${want.join('')}`, JSON.stringify(got) === JSON.stringify(want.slice().sort()),
    got.join(',') || '未作答');
}
ok('多选收窄答案后旧选项被清除（A、B 保留，C、D 取消）',
  JSON.stringify(exam.afterNarrow) === JSON.stringify(['A', 'B']),
  (exam.afterNarrow || []).join(',') || '未取到');
ok('面板开关是按钮而非勾选框', exam.toggleIsButton === true);
ok('开关点击后文案从「关」变「开」',
  exam.toggleTextBefore === '关' && exam.toggleTextAfter === '开',
  `${exam.toggleTextBefore} -> ${exam.toggleTextAfter}`);
ok('开关同步 aria-pressed', exam.togglePressed === 'true', String(exam.togglePressed));
ok('面板内没有勾选框', exam.checkboxes === 0, String(exam.checkboxes));
ok('面板共有 6 个胶囊开关', exam.toggleCount === 6, String(exam.toggleCount));
ok('面板标题为「公务员网络培训助手」', exam.title === '公务员网络培训助手', String(exam.title));
ok('本地文件不在省份表内，状态条显示「通用适配」',
  exam.siteLabel === '通用适配', String(exam.siteLabel));
ok('面板开关写入存储', exam.savedAutoSubmit === 'true', String(exam.savedAutoSubmit));
ok('诊断包格式正确', exam.diagFormat === 'gwypx-diagnostics', String(exam.diagFormat));
ok('诊断包识别页面类型为 exam', exam.diagPageType === 'exam', String(exam.diagPageType));
ok('诊断包 URL 不含查询串', exam.diagUrlHasQuery === false);
ok('诊断包记录了适配层命中数', exam.diagSelectors > 5, String(exam.diagSelectors));
ok('诊断包记录了题库条数', exam.diagBank > 400, String(exam.diagBank));
ok('诊断包用布尔位表示是否配了 Key（不落明文）', exam.diagHasKeyFlag === true);
ok('面板显示已作答 5/5', /5\/5/.test(exam.state || ''), exam.state);
ok('面板显示题库条数', /\d+ 条/.test(exam.bankCnt || ''), exam.bankCnt);
ok('面板识别出试卷题型', /5 题/.test(exam.examCnt || ''), exam.examCnt);

// ------------------------------------------------------------------ 播放页
console.log('\n[2/2] 播放页：失焦解锁');
const playerProbe = `
setTimeout(function () {
  var r = { at: Date.now() };
  r.onblurIsNull = (window.onblur === null);
  r.before = window.__blurCalls;
  window.dispatchEvent(new Event('blur'));
  r.afterDispatch = window.__blurCalls;
  var late = 0;
  window.addEventListener('blur', function () { late += 1; });
  window.dispatchEvent(new Event('blur'));
  r.lateFired = late;
  var host = document.getElementById('csta-panel-host');
  r.panel = !!(host && host.shadowRoot);
  if (r.panel) {
    var el = host.shadowRoot.querySelector('[data-el="playCnt"]');
    r.playCnt = el ? el.textContent : null;
    var st = host.shadowRoot.querySelector('[data-el="state"]');
    r.state = st ? st.textContent : null;
  }
  r.errors = window.__pageErrors;
  document.getElementById('__r').textContent = JSON.stringify(r);
}, 2500);
`;

// 放在与真实地址相同的路径层级，让 isPlayerPage() 的路径判定真正被测到
const player = run(build('player.html', playerProbe, 6000), 6000, 'gansu-spcrm/videoPlayGJ');
ok('页面无 JS 报错', player.errors.length === 0, player.errors.join(' | '));
ok('window.onblur 已被清空', player.onblurIsNull === true);
ok('派发 blur 后平台 handler 零次触发', player.afterDispatch === player.before,
  `${player.before} -> ${player.afterDispatch}`);
ok('事后注册的 blur 监听同样被拦截', player.lateFired === 0, String(player.lateFired));
ok('面板在播放页可用', player.panel);
ok('面板显示已接管播放器', /已接管/.test(player.playCnt || ''), player.playCnt);

rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n合计 ${failed} 项失败\n` : '\n页面冒烟全部通过\n');
process.exit(failed ? 1 : 0);
