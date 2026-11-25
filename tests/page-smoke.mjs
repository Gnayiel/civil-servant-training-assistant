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
// 脚本的 VERSION 取自 GM_info.script.version，桩里必须填真版本，
// 否则「检查更新」的版本比较会把本地版本当成非法值，永远判不出版本更新。
const LOCAL = (/^\/\/\s*@version\s+(\S+)/m.exec(SCRIPT) || [, '0.0.0'])[1];

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
// 默认拒绝联网。探针要测「检查更新」时，先往 window.__gmResponses 里放
// URL 片段 -> 响应体 的映射，命中就走映射，未命中仍然抛错，防联网语义不变。
window.GM_xmlhttpRequest = function (o) {
  var map = window.__gmResponses || {};
  for (var k in map) {
    if (o.url.indexOf(k) >= 0) {
      var body = map[k];
      setTimeout(function () { o.onload({ status: 200, responseText: body }); }, 0);
      return;
    }
  }
  throw new Error('冒烟测试不应联网');
};
window.GM_info = { script: { version: '__VERSION__' } };
// 统计 document 上的 click 监听数量：守「反复拨开关不累积监听」这条回归
window.__docClickCount = 0;
(function () {
  var raw = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opt) {
    if (type === 'click') window.__docClickCount++;
    return raw(type, fn, opt);
  };
}());
// 无头浏览器里 alert 会阻塞渲染直到有人点确定，--dump-dom 会一直挂着。
// 脚本的 hookSubmitAlert 会保留原始 alert 并在最后调用它，所以必须在脚本加载前就把它换成空函数。
window.alert = function (msg) { (window.__alerts = window.__alerts || []).push(String(msg)); };
window.confirm = function () { return true; };
window.__pageErrors = [];
window.addEventListener('error', function (e) { if (e && e.message) window.__pageErrors.push(String(e.message)); }, true);
</script>`;

function build(fixture, probe, budgetMs, fakePath) {
  const html = readFileSync(join(HERE, 'fixtures', fixture), 'utf8');
  return html
    .replace('</head>', `${STUB.replace('__VERSION__', LOCAL)}</head>`)
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
console.log('\n[1/3] 试卷页：解析与填答');
const examProbe = `
// 与法宣一致：进试卷页不自动作答，必须点顶栏「开始」。探针先替用户点一下。
setTimeout(function () {
  var h0 = document.getElementById('csta-panel-host');
  var b0 = h0 && h0.shadowRoot && h0.shadowRoot.querySelector('#fx-stop');
  if (b0) b0.click();
}, 400);
setTimeout(function () {
  var r = { at: Date.now(), steps: [] };
  var step = function (name) { r.steps.push(name); };
  // 把每一段包进 try/catch：单独一段失败不应该让整个探针没输出，
  // 否则只能看到「探针未执行」，定位成本极高。
  var guard = function (name, fn) {
    try { fn(); r.steps.push(name + ':ok'); }
    catch (e) { r.steps.push(name + ':ERR ' + (e && e.message)); }
  };
  var host = document.getElementById('csta-panel-host');
  r.panel = !!host;
  r.shadow = !!(host && host.shadowRoot);
  if (host && host.shadowRoot) {
    var q = function (s) { var el = host.shadowRoot.querySelector(s); return el ? el.textContent : null; };
    // 新面板：状态在 #fx-status，题库与试卷摘要移到分类 badge
    r.state = q('#fx-status');
    r.bankCnt = q('#fx-gb-bank');
    r.modeCnt = q('#fx-gb-mode');
  }
  var parsed = window.__GWX_TEST__ ? window.__GWX_TEST__.parseExam() : [];
  // 正常页面上不该有任何题因为「题干读不出来」被丢弃
  r.parseDropped = (function () {
    if (!window.__GWX_TEST__ || !window.__GWX_TEST__.parseExamDetailed) return null;
    return window.__GWX_TEST__.parseExamDetailed().dropped;
  })();
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
    var cb = host.shadowRoot.querySelector('#fx-submit');
    r.toggleIsButton = !!cb && cb.tagName === 'BUTTON';
    r.toggleActiveBefore = cb ? cb.classList.contains('active') : null;
    if (cb) cb.click();
    r.toggleActiveAfter = cb ? cb.classList.contains('active') : null;
    r.togglePressed = cb ? cb.getAttribute('aria-pressed') : null;
    r.savedAutoSubmit = localStorage.getItem('gwx_cfg_autoSubmit');
    // 面板里不应再出现勾选框
    r.checkboxes = host.shadowRoot.querySelectorAll('input[type=checkbox]').length;
    r.toggleCount = host.shadowRoot.querySelectorAll('button.tog').length;
    r.siteLabel = host.shadowRoot.querySelector('#fx-stats')
      ? host.shadowRoot.querySelector('#fx-stats').textContent : null;
    // 新面板标题在 .panel-title 的第二个 span（第一个是状态圆点）
    var titleSpans = host.shadowRoot.querySelectorAll('.panel-title span');
    r.title = titleSpans.length > 1 ? titleSpans[1].textContent : null;
    r.verBadge = host.shadowRoot.querySelector('.title-ver')
      ? host.shadowRoot.querySelector('.title-ver').textContent : null;
    r.groupCount = host.shadowRoot.querySelectorAll('.group').length;
    r.hasProgress = !!host.shadowRoot.querySelector('#fx-fill');
    r.hasLogBox = !!host.shadowRoot.querySelector('.log-box');
    // 「调试」默认关，此时面板里不该出现任何 debug 级别的行。
    // 通道明细是散在查询链里发的，曾经有一处漏了走 dbg()，开关就成了摆设。
    r.debugLines = host.shadowRoot.querySelectorAll('#fx-log .log-line.log-debug').length;
    r.debugBtn = (host.shadowRoot.querySelector('#fx-debug') || {}).textContent;

    // 收起态窄条：标题必须排成一行、且左右留白对称。
    // 标题 9 个字（公务员网络培训助手）比法宣的 6 个字长，曾因 132px 容不下而折成两行。
    (function () {
      var tg = host.shadowRoot.querySelector('#fx-toggle');
      if (!tg) return;
      tg.click();
      var pnl = host.shadowRoot.querySelector('#fx-panel');
      var ct = host.shadowRoot.querySelector('#fx-collapse-title');
      if (!pnl || !ct || !pnl.classList.contains('collapsed')) return;
      var pcs = getComputedStyle(pnl);
      var tcs = getComputedStyle(ct);
      var pr = pnl.getBoundingClientRect();
      var lineH = parseFloat(tcs.lineHeight) || 0;
      var boxH = ct.getBoundingClientRect().height;
      var range = document.createRange();
      range.selectNodeContents(ct);
      var tr = range.getBoundingClientRect();
      var innerL = pr.left + parseFloat(pcs.paddingLeft);
      var innerR = pr.right - parseFloat(pcs.paddingRight);
      r.foldTitle = {
        lines: lineH ? Math.round(boxH / lineH) : null,
        whiteSpace: tcs.whiteSpace,
        gapLeft: Math.round((tr.left - innerL) * 10) / 10,
        gapRight: Math.round((innerR - tr.right) * 10) / 10,
        textW: Math.round(tr.width * 10) / 10,
      };
      tg.click();  // 还原，别影响后续断言
    })();
  }
  // 诊断包结构（脱敏细节由 Node 自检精确覆盖，这里不看正则）
  guard('diag', function () {
    var d = window.__GWX_TEST__.buildDiagnostics();
    r.diagFormat = d.format;
    r.diagPageType = d.page.type;
    r.diagUrlHasQuery = d.page.url.indexOf('?') !== -1;
    r.diagLogs = (d.logs || []).length;
    r.diagSelectors = Object.keys(d.selectors || {}).length;
    r.diagBank = d.counts.bank;
    r.diagHasKeyFlag = typeof d.config.hasKey === 'boolean';
  });
  // 对账必须写回「页面上实际选中的答案」，而不是脚本作答时的快照。
  // 复现：脚本填完 → 用户手改第 1 题 → 交卷通过 → 题库里应是改后的答案。
  guard('reconcile', function () {
    var t = window.__GWX_TEST__;
    var qs = t.parseExam();
    if (!qs.length) { r.reconcile = 'no-questions'; return; }
    // 先把第 1 题改成 D（脚本原本填 C）
    var q0 = qs[0];
    q0.options.forEach(function (o) { if (o.input.checked) o.input.click(); });
    var d = q0.options.filter(function (o) { return o.letter === 'D'; })[0];
    if (d && !d.input.checked) d.input.click();
    r.afterManualChange = q0.options.filter(function (o) {
      return o.input && o.input.checked;
    }).map(function (o) { return o.letter; });
    // 触发对账；再补一次 alert 模拟「平台重复弹窗」——
    // 第二次不能再对账一遍（重复对账会把题库写乱）
    window.alert('您已通过本次考试！');
    window.alert('您已通过本次考试！');
    var h5 = document.getElementById('csta-panel-host');
    var logText = (h5 && h5.shadowRoot) ? h5.shadowRoot.querySelector('#fx-log').textContent : '';
    r.reconcileRuns = (logText.match(/开始对账/g) || []).length;
    // 读回题库里第 1 题存的答案
    var bank = JSON.parse(localStorage.getItem('gwx_bank') || '{}');
    var key = t.fpKey(q0.stem);
    var entry = bank[key];
    r.reconciledAnswer = entry ? entry.a : null;
    r.reconciledOk = entry ? entry.ok : 0;
  });

  // 顶栏：与法宣同结构——「开始/停止」「暂停」「收起」，未运行时暂停必须禁用。
  // 文案的三种状态由纯函数 runBtnLabels 在自检里覆盖，这里只验渲染结果。
  guard('btnFlow', function () {
    var host2 = document.getElementById('csta-panel-host');
    var sr = host2 && host2.shadowRoot;
    if (!sr) { r.btnFlow = 'no-panel'; return; }
    var btn = sr.querySelector('#fx-stop');
    var pause = sr.querySelector('#fx-pause');
    var toggle = sr.querySelector('#fx-toggle');
    r.btnTextIdle = btn ? btn.textContent : null;
    r.btnHasStopClass = btn ? btn.classList.contains('active') : null;
    r.pauseText = pause ? pause.textContent : null;
    r.pauseDisabled = pause ? pause.disabled : null;
    r.toggleText = toggle ? toggle.textContent : null;
    var lb = window.__GWX_TEST__.runBtnLabels
      ? window.__GWX_TEST__.runBtnLabels(true, false) : null;
    r.labelRunning = lb ? lb.stop : null;
    var lb2 = window.__GWX_TEST__.runBtnLabels
      ? window.__GWX_TEST__.runBtnLabels(true, true) : null;
    r.labelPaused = lb2 ? lb2.pause : null;
  });

  // 模拟「脚本升级带来新题」：内置题库变化时 mergeSeed 应把缺失的补回来。
  // 注意不能直接改 localStorage 来模拟——内存里还有 bankCache，那样测的是缓存而非逻辑。
  guard('seed', function () {
    var t = window.__GWX_TEST__;
    r.seedSig = t.seedSignature();
    r.seedSigStable = (t.seedSignature() === r.seedSig);
    r.bankBefore = Object.keys(JSON.parse(localStorage.getItem('gwx_bank') || '{}')).length;
    // 题库已齐时补全应返回 0（幂等）
    r.mergeWhenFull = t.mergeSeed();
    // 先经面板「清空题库」清掉内存缓存与存储，再补全
    var h3 = document.getElementById('csta-panel-host');
    var sr3 = h3 && h3.shadowRoot;
    var clr = sr3 && sr3.querySelector('#fx-clear-bank');
    if (clr) clr.click();
    r.afterClear = Object.keys(JSON.parse(localStorage.getItem('gwx_bank') || '{}')).length;
    r.refilledCount = t.mergeSeed();
    r.afterRefill = Object.keys(JSON.parse(localStorage.getItem('gwx_bank') || '{}')).length;
  });

  // CSV 往返：导出后再导入，答案不能丢，也不能把「答案来源」当成答案读进来
  guard('csv', function () {
    var t = window.__GWX_TEST__;
    var csv = t.bankToCsv();
    // 注意：探针本身在模板字符串里，任何转义序列都会被解析成真实字符。
    // 所以这里不写转义，直接用 fromCharCode 取换行符。
    var LF = String.fromCharCode(10);
    var CR = String.fromCharCode(13);
    var csvLines = csv.split(LF).map(function (x) {
      return x.charAt(x.length - 1) === CR ? x.slice(0, -1) : x;
    });
    r.csvHeader = csvLines[0];
    r.csvRows = csvLines.length - 1;
    // 快照必须在「清空」之前取：清之后库就空了，比对会变成 0 题
    var bankSnap = JSON.parse(localStorage.getItem('gwx_bank') || '{}');
    r.csvAnswerSnapshot = Object.keys(bankSnap).map(function (k) {
      return [k, (bankSnap[k].a || []).join('\u0001')];
    });
    // 清空后重新导入
    var h4 = document.getElementById('csta-panel-host');
    var sr4 = h4 && h4.shadowRoot;
    var clr2 = sr4 && sr4.querySelector('#fx-clear-bank');
    if (clr2) clr2.click();
    var res = t.importData(csv);
    r.importMsg = res && res.msg;
    var bank2 = JSON.parse(localStorage.getItem('gwx_bank') || '{}');
    r.__bankAfter = JSON.stringify(bank2);
    var keys = Object.keys(bank2);
    r.importedCount = keys.length;
    // 抽查：答案列不能是「内置/交卷验证」这类来源词
    var badSrc = keys.filter(function (k) {
      var a = bank2[k].a || [];
      return a.some(function (x) { return /^(内置|导入|交卷验证|手改)$/.test(x); });
    });
    r.importedBadSource = badSrc.length;
    // 抽查一条原题答案是否保住
    var probe = bank2[t.fpKey('新时代我国社会主要矛盾是（ ）。')];
    r.importedAnswer = probe ? probe.a : null;
  });

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
ok('正常页面没有题因题干读不出被丢弃', exam.parseDropped === 0, String(exam.parseDropped));
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
ok('开关点击后 active 类翻转',
  exam.toggleActiveBefore === false && exam.toggleActiveAfter === true,
  `${exam.toggleActiveBefore} -> ${exam.toggleActiveAfter}`);
ok('开关同步 aria-pressed', exam.togglePressed === 'true', String(exam.togglePressed));
ok('面板内没有勾选框', exam.checkboxes === 0, String(exam.checkboxes));
ok('面板有 5 个分类组（与法宣同一结构）', exam.groupCount === 5, String(exam.groupCount));
ok('面板有进度条', exam.hasProgress === true);
ok('面板有日志框', exam.hasLogBox === true);
ok('「调试」默认关时面板里没有 debug 明细行',
  exam.debugLines === 0 && exam.debugBtn === '调试：关',
  `${exam.debugBtn} / ${exam.debugLines} 行`);
ok('版本徽章带 v 前缀', /^v\S+$/.test(exam.verBadge || ''), String(exam.verBadge));
ok('面板标题为「公务员网络培训助手」', exam.title === '公务员网络培训助手', String(exam.title));
ok('底部统计第一行是题库与存储占用',
  /^题库 \d+ 题/.test(exam.siteLabel || '') && /KB/.test(exam.siteLabel || ''), String(exam.siteLabel));
ok('统计行同时显示题库条数', /题库 \d+ 题/.test(exam.siteLabel || ''), String(exam.siteLabel));
ok('统计行是纯文本，不含 emoji（渲染不依赖字体）',
  !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(exam.siteLabel || ''), String(exam.siteLabel));
ok('面板开关写入存储', exam.savedAutoSubmit === 'true', String(exam.savedAutoSubmit));
ok('诊断包格式正确', exam.diagFormat === 'gwypx-diagnostics', String(exam.diagFormat));
ok('诊断包识别页面类型为 exam', exam.diagPageType === 'exam', String(exam.diagPageType));
ok('诊断包 URL 不含查询串', exam.diagUrlHasQuery === false);
ok('诊断包记录了适配层命中数', exam.diagSelectors > 5, String(exam.diagSelectors));
ok('诊断包记录了题库条数', exam.diagBank > 400, String(exam.diagBank));
ok('诊断包用布尔位表示是否配了 Key（不落明文）', exam.diagHasKeyFlag === true);
ok('手改第 1 题为 D 后，DOM 确实是 D',
  JSON.stringify(exam.afterManualChange) === JSON.stringify(['D']),
  JSON.stringify(exam.afterManualChange));
ok('对账写回的是改后的答案（不是脚本快照的 C）',
  JSON.stringify(exam.reconciledAnswer) === JSON.stringify(['文化建设']),
  JSON.stringify(exam.reconciledAnswer));
ok('对账把 ok 计为 1', exam.reconciledOk === 1, String(exam.reconciledOk));
ok('平台重复弹「已通过」只对账一次（不会重复写库）',
  exam.reconcileRuns === 1, `对账 ${exam.reconcileRuns} 次`);
ok('主按钮初始为「开始」', exam.btnTextIdle === '开始', String(exam.btnTextIdle));
ok('初始态主按钮不带 active 类', exam.btnHasStopClass === false);
ok('暂停按钮文案为「暂停」', exam.pauseText === '暂停', String(exam.pauseText));
ok('未运行时暂停按钮禁用', exam.pauseDisabled === true, String(exam.pauseDisabled));
ok('收起按钮文案为「收起」', exam.toggleText === '收起', String(exam.toggleText));
ok('运行态主按钮文案为「停止」', exam.labelRunning === '停止', String(exam.labelRunning));
ok('暂停态按钮文案为「继续」', exam.labelPaused === '继续', String(exam.labelPaused));
ok('种子指纹稳定', exam.seedSigStable === true, String(exam.seedSig));
ok('题库已齐时 mergeSeed 幂等（返回 0）', exam.mergeWhenFull === 0,
  String(exam.mergeWhenFull));
ok('清空题库后确实为空', exam.afterClear === 0, String(exam.afterClear));
ok('清空后 mergeSeed 能补回全部内置题（模拟脚本升级带新题）',
  exam.refilledCount > 400 && exam.afterRefill === exam.bankBefore,
  `补回 ${exam.refilledCount} 条，落盘 ${exam.afterRefill} 条，原 ${exam.bankBefore} 条`);
ok('CSV 表头是新的真实列', /答案来源/.test(exam.csvHeader || ''), exam.csvHeader);
ok('CSV 行数与题库一致', exam.csvRows === exam.bankBefore, `${exam.csvRows}/${exam.bankBefore}`);
ok('CSV 重新导入条数一致', exam.importedCount === exam.bankBefore,
  `${exam.importedCount}/${exam.bankBefore}`);
ok('导入没有把「答案来源」当成答案',
  exam.importedBadSource === 0, `${exam.importedBadSource} 条异常`);
ok('CSV 往返后每道题的答案一字不差（中文标点不能被当成分隔符）',
  (function () {
    var before = exam.csvAnswerSnapshot || [];
    if (!before.length) return false;
    var after = JSON.parse(exam.__bankAfter || '{}');
    return before.every(function (pair) {
      var e = after[pair[0]];
      return e && (e.a || []).join('\u0001') === pair[1];
    });
  })(), `${(exam.csvAnswerSnapshot || []).length} 题比对`);
ok('导入后答案内容正确',
  JSON.stringify(exam.importedAnswer) === JSON.stringify(['人民日益增长的美好生活需要和不平衡不充分的发展之间的矛盾']),
  JSON.stringify(exam.importedAnswer));
ok('面板状态行是法宣的状态词', /就绪|答题中|已停止/.test(exam.state || ''), exam.state);
ok('面板显示题库条数', /题库 \d+ 题/.test(exam.bankCnt || ''), exam.bankCnt);
ok('面板摘要显示当前模式与节奏', /百度搜索|AI智能/.test(exam.modeCnt || ''), exam.modeCnt);

// ------------------------------------------------------------------ 播放页
console.log('\n[2/3] 播放页：失焦解锁');
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
    var el = host.shadowRoot.querySelector('#fx-gb-play');
    r.playCnt = el ? el.textContent : null;
    var st = host.shadowRoot.querySelector('#fx-status');
    r.state = st ? st.textContent : null;
  }
  // 验证拦截器本身是否生效：用一个独立注册的 blur 监听当探针。
  // 平台的 onblur 在安装时已被摘掉，所以不能拿它当判据。
  var probeHits = 0;
  window.addEventListener('blur', function () { probeHits += 1; });
  var sr2 = host && host.shadowRoot;
  var tg = sr2 && sr2.querySelector('#fx-unlock');
  if (tg) {
    // 开关默认是「开」：拦截器应吃掉这次 blur，探针收不到
    probeHits = 0;
    window.dispatchEvent(new Event('blur'));
    r.probeOnBlocked = (probeHits === 0);

    // 关掉开关后不���拦截，探针应收到
    tg.click();
    probeHits = 0;
    window.dispatchEvent(new Event('blur'));
    r.probeOffPassed = (probeHits === 1);

    // 再打开，恢复拦截
    tg.click();
    probeHits = 0;
    window.dispatchEvent(new Event('blur'));
    r.probeOnAgain = (probeHits === 0);
  }

  // 反复拨「意外暂停续播」不应累积 document 监听。
  // applyLive() 每次拨动都会重放 watchVideo()，而它里面挂 document click 监听 ——
  // 没有守卫时每拨一次「开启」就多挂一个，且没有上限（实测拨 6 次多 3 个）。
  r.clickListenersAdded = (function () {
    var before = window.__docClickCount || 0;
    var keep = sr2 && sr2.querySelector('#fx-keep');
    if (keep) { for (var i = 0; i < 6; i++) keep.click(); }
    return (window.__docClickCount || 0) - before;
  })();

  // 静音开关：默认开 → 脚本把 video 静音；关掉后必须把声音还回去。
  // install() 只在首次执行，所以这一步实际在验 applyLive() 有没有跑。
  var muteBtn = sr2 && sr2.querySelector('#fx-mute');
  var vid = document.querySelector('video');
  if (muteBtn && vid) {
    r.mutedDefault = vid.muted;          // 应为 true（fixture 带 muted 属性 + 脚本也设了）
    muteBtn.click();                     // 关掉静音
    r.mutedAfterOff = vid.muted;          // 应为 false
    muteBtn.click();                     // 再打开
    r.mutedAfterOn = vid.muted;           // 应为 true
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
ok('开关打开时拦截器生效（探针监听收不到 blur）', player.probeOnBlocked === true);
ok('关掉开关后拦截器放行（探针监听收到 blur）', player.probeOffPassed === true,
  String(player.probeOffPassed));
ok('重新打开开关又恢复拦截', player.probeOnAgain === true);
ok('收起态标题排成一行（不被窄条挤断）',
  exam.foldTitle && exam.foldTitle.lines === 1 && exam.foldTitle.whiteSpace === 'nowrap',
  JSON.stringify(exam.foldTitle));
ok('收起态标题左右留白对称',
  exam.foldTitle && exam.foldTitle.gapLeft === exam.foldTitle.gapRight
    && exam.foldTitle.gapLeft >= 4,
  JSON.stringify(exam.foldTitle));
ok('反复拨播放开关不会累积 document 监听',
  player.clickListenersAdded === 0, `新增 ${player.clickListenersAdded} 个`);
ok('静音开关默认生效', player.mutedDefault === true, String(player.mutedDefault));
ok('关掉静音后声音恢复（applyLive 真的在跑）', player.mutedAfterOff === false,
  String(player.mutedAfterOff));
ok('重新打开静音又静音', player.mutedAfterOn === true, String(player.mutedAfterOn));

// ------------------------------------------------- 检查更新：多源合并取较高版本
console.log('\n[3/3] 检查更新：CDN 滞后时仍能发现新版本');
const NEWER = LOCAL.replace(/(\d+)$/, (n) => String(Number(n) + 1));
const CDN_KEY = 'civil-servant-training-assistant.user.js';
const API_KEY = 'api.github.com';

// 三个场景依次跑：CDN 滞后 / 两源一致 / 两源都不可达。
// 每个场景都点一次面板上的真按钮，走的是和用户完全相同的路径。
const updateProbe = `
(function () {
  var scenarios = ${JSON.stringify([
    { id: 'staleCdn', cdn: '1.0.0', api: 'v' + NEWER },
    { id: 'same', cdn: LOCAL, api: 'v' + LOCAL },
    { id: 'down', cdn: null, api: null },
  ])};
  var CDN_KEY = ${JSON.stringify(CDN_KEY)};
  var API_KEY = ${JSON.stringify(API_KEY)};
  var out = [];

  function bodyFor(v, isApi) {
    return isApi ? JSON.stringify({ tag_name: v }) : '// ==UserScript==' + String.fromCharCode(10)
      + '// @version ' + v + String.fromCharCode(10);
  }

  function step(i) {
    if (i >= scenarios.length) {
      document.getElementById('__r').textContent = JSON.stringify({ scenarios: out });
      return;
    }
    var sc = scenarios[i];
    window.__gmResponses = {};
    if (sc.cdn) window.__gmResponses[CDN_KEY] = bodyFor(sc.cdn, false);
    if (sc.api) window.__gmResponses[API_KEY] = bodyFor(sc.api, true);

    var host = document.getElementById('csta-panel-host');
    var sr = host && host.shadowRoot;
    var btn = sr && sr.querySelector('#fx-checkupdate');
    var notice = sr && sr.querySelector('#fx-notice');
    var status = sr && sr.querySelector('#fx-status');
    var logbox = sr && sr.querySelector('#fx-log');
    if (!btn) { out.push({ id: sc.id, err: 'no-button' }); step(i + 1); return; }

    btn.click();
    // checkUpdate 是异步的（Promise + 定时器），等它落定再读界面
    setTimeout(function () {
      out.push({
        id: sc.id,
        status: status ? status.textContent : null,
        noticeShown: notice ? notice.style.display !== 'none' : null,
        noticeText: notice ? notice.textContent : null,
        logTail: logbox ? logbox.textContent.slice(-260) : null,
      });
      step(i + 1);
    }, 320);
  }
  setTimeout(function () { step(0); }, 700);
}());
`;

// 用播放页跑：试卷页 1200ms 会自动开始作答并覆盖状态栏，三个场景会被它改写
const upd = run(build('player.html', updateProbe, 12000), 12000, 'gansu-spcrm/videoPlayGJ');
const byId = Object.fromEntries((upd.scenarios || []).map((s) => [s.id, s]));

ok('三个场景都跑到了按钮', Object.keys(byId).length === 3, Object.keys(byId).join(','));
ok('CDN 停在 1.0.0 时仍报出新版本（来源 Releases API）',
  /有新版本/.test((byId.staleCdn || {}).status || ''), (byId.staleCdn || {}).status);
ok('CDN 滞后场景的日志写明来源是 GitHub Release',
  /GitHub Release/.test((byId.staleCdn || {}).logTail || ''),
  (byId.staleCdn || {}).logTail);
ok('CDN 滞后时会弹出提示条',
  (byId.staleCdn || {}).noticeShown === true, String((byId.staleCdn || {}).noticeShown));
ok('两源一致时判为已是最新',
  /已是最新/.test((byId.same || {}).status || ''), (byId.same || {}).status);
ok('两源都不可达时明确报失败，不谎称已是最新',
  /失败/.test((byId.down || {}).status || ''), (byId.down || {}).status);
ok('失败时日志里带上每个源的失败原因',
  /jsDelivr/.test((byId.down || {}).logTail || '') && /GitHub Release/.test((byId.down || {}).logTail || ''),
  (byId.down || {}).logTail);

rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n合计 ${failed} 项失败\n` : '\n页面冒烟全部通过\n');
process.exit(failed ? 1 : 0);
