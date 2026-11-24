#!/usr/bin/env node
/**
 * 文档配图生成：把 docs/panel.webp 与两张社交预览图从 HTML 重新渲染。
 *
 *   node tools/generate-docs-images.mjs                 # 读 package.json 版本
 *   node tools/generate-docs-images.mjs --version 1.1.1
 *
 * 依赖：Chrome/Chromium（可用 CHROME 指定）、ffmpeg（PNG→WebP，可用 FFMPEG 指定）、中文字体。
 *
 * 为什么用脚本生成：版本号、自检数、题库条数都会变，手工维护三张图必然漂移。
 * 面板图复用脚本自身的面板样式与固定演示状态；社交预览是独立 HTML，右侧嵌入面板。
 * 只在本地手动运行，不进入 CI。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp-docs-images');
const SCRIPT = join(ROOT, 'civil-servant-training-assistant.user.js');

function arg(name, dft = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dft;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dft;
}

const CHROME = process.env.CHROME || [
  '/home/abc/.cache/chsarm/chrome-headless-shell-linux-arm64/chrome-headless-shell',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));

const FFMPEG = process.env.FFMPEG || ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p));

if (!CHROME) {
  console.error('找不到 Chrome/Chromium。请安装，或用 CHROME=/path/to/chrome 指定。');
  process.exit(1);
}
if (!FFMPEG) {
  console.error('找不到 ffmpeg。请安装，或用 FFMPEG=/path/to/ffmpeg 指定。');
  process.exit(1);
}

// ---------------------------------------------------------------- 读取动态数字
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = arg('version', pkg.version);
const seed = JSON.parse(readFileSync(join(ROOT, 'data', 'bank-seed.json'), 'utf8'));
const uniq = JSON.parse(readFileSync(join(ROOT, 'data', 'questions-unique.json'), 'utf8'));
const userScript = readFileSync(SCRIPT, 'utf8');

// 面板内置自检的项数（脚本里 eq(...) 的调用数）。
// 注意这不是全仓库断言总数：那样要把 5 个检查脚本都跑一遍，配图生成器不该依赖它们。
// 社交预览里因此写「内置自检 N 项」而不是笼统的「N 项断言」。
const selfTestCount = (userScript.match(/\beq\(/g) || []).length;
const bankCount = seed.length;
const coverage = ((seed.length / uniq.length) * 100).toFixed(1);

console.log(`版本 ${version} · 题库 ${bankCount} 条 · 自检 ${selfTestCount} 项 · 覆盖率 ${coverage}%`);

mkdirSync(TMP, { recursive: true });

// ---------------------------------------------------------------- 面板 HTML
/**
 * 纯面板特写，与「法宣在线助手」的 docs/panel.webp 同一形态：
 * 只截面板本身，不合成试卷背景。视口 316×561、2 倍缩放 → 632×1122。
 *
 * 面板在脚本里是 `position: fixed` 挂在右上角的；配图需要它成为画面主体，
 * 所以往影子根里塞一段 style 把它改成静态居中。外部选择器进不了 Shadow DOM，
 * 只能这样改——这也是文档级 CSS 在这里完全无效的原因。
 */
function panelHtml() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #0b0e13; overflow: hidden; }
  body { padding: 8px; }
</style>
<script>
window.GM_getValue = function (k, d) {
  var v = localStorage.getItem(k);
  return v === null ? d : JSON.parse(v);
};
window.GM_setValue = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };
window.GM_xmlhttpRequest = function () { throw new Error('配图不联网'); };
window.GM_info = { script: { version: '${version}' } };
window.alert = function () {}; window.confirm = function () { return true; };
</script>
</head><body>
<!-- 脚本有个启动守卫：域名不在适配表里、且页面看不出是培训平台时静默退出。
     配图页是 file://，页面上必须放一套最小试卷结构，面板才会被创建。
     这一段 display:none，不进画面。 -->
<form id="examInfoFrom" style="display:none">
  <input type="hidden" name="courseId" value="1246">
  <input type="hidden" name="testTime" value="10">
  <div class="shiti">
    <div class="shiti_l"><h2>一、单选题（共 2 道题）</h2>
      <dl class="danxuan"><dt><span>1.</span>占位题干一（20分）</dt></dl>
      <div class="xuxiang">
        <label><input type="radio" name="danxuan9101" value="A">A</label>
        <label><input type="radio" name="danxuan9101" value="B">B</label>
      </div>
      <dl class="danxuan"><dt><span>2.</span>占位题干二（20分）</dt></dl>
      <div class="xuxiang">
        <label><input type="radio" name="danxuan9102" value="A">A</label>
        <label><input type="radio" name="danxuan9102" value="B">B</label>
      </div>
    </div>
    <div class="shiti_l"><h2>二、多选题（共 1 道题）</h2>
      <dl class="danxuan"><dt><span>1.</span>占位题干三（20分）</dt></dl>
      <div class="xuxiang">
        <label><input type="checkbox" name="duoxuan9103" value="A">A</label>
        <label><input type="checkbox" name="duoxuan9103" value="B">B</label>
      </div>
    </div>
    <div class="shiti_l"><h2>三、判断题（共 2 道题）</h2>
      <div class="shiti_l">
        <dl class="danxuan"><dt><span>1.</span>占位题干四</dt></dl>
        <div class="xuxiang">
          <label><input type="radio" name="panduan9104" value="1">对</label>
          <label><input type="radio" name="panduan9104" value="0">错</label>
        </div>
      </div>
      <div class="shiti_l">
        <dl class="danxuan"><dt><span>2.</span>占位题干五</dt></dl>
        <div class="xuxiang">
          <label><input type="radio" name="panduan9105" value="1">对</label>
          <label><input type="radio" name="panduan9105" value="0">错</label>
        </div>
      </div>
    </div>
  </div>
  <div class="shiti_r"><span id="hh">00</span><span id="mm">09</span><span id="ss">47</span></div>
</form>
<script>${userScript}</script>
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var host = document.getElementById('csta-panel-host');
    var root = host && host.shadowRoot;
    if (!root) return;
    var st = document.createElement('style');
    st.id = '__shot';
    st.textContent = ''
      // 1) 定位改为静态，让面板成为画面主体（原来是 fixed 在右上角）
      + '#fx-panel{position:static!important;width:300px!important;'
      + 'max-height:none!important;margin:0 auto!important;}'
      // 2) 字体不用管：面板文案已全部改成纯文本（与法宣成品一致），
      //    不再依赖 emoji 字体。此前为渲染统计行里的图标字符折腾过三条路都不通：
      //    @font-face 的 block 会让整段文字不绘制、swap 则字体永不加载、
      //    文档级选择器又进不了 Shadow DOM。
      ;
    root.appendChild(st);

    // 3) 展开「日志与自检」，与法宣图一致（其余分类收起）
    var head = root.querySelector('#fx-group-log .group-head');
    if (head) head.click();

    // 4) 演示日志。脚本真实启动日志里带着本机临时路径（页面的 file:// 地址），
    //    会被截图进 README，所以这里覆盖成一段干净且能说明状态的演示内容。
    var box = root.querySelector('#fx-log');
    if (box) {
      var lines = [
        ['[10:12:03] 插件已加载 v${version} · 甘肃省', 'log-info'],
        ['[10:12:05] 等待考试页面就绪…', 'log-info'],
        ['[10:12:06] 自检 ${selfTestCount}/${selfTestCount} 项通过', 'log-ok'],
      ];
      box.innerHTML = lines.map(function (x) {
        var d = document.createElement('div');
        d.className = 'log-line ' + x[1];
        d.textContent = x[0];
        return d.outerHTML;
      }).join('');
      var badge = root.querySelector('#fx-gb-log');
      if (badge) badge.textContent = '日志 ' + lines.length + ' 行';
    }
  }, 2000);
});
</script>
</body></html>`;
}

// ---------------------------------------------------------------- 社交预览
function socialHtml(dark) {
  const bg = dark ? '#12151a' : '#eef1f5';
  const card = dark ? '#1b1e24' : '#ffffff';
  const fg = dark ? '#e7eaf0' : '#1a2130';
  const sub = dark ? '#8b95a8' : '#5d6675';
  const accent = '#2b5fd9';
  const panelAbs = join(ROOT, 'docs', 'panel.webp');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{width:1280px;height:640px;background:${bg};font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;
         display:flex;align-items:center;gap:56px;padding:0 72px;overflow:hidden}
    .left{flex:1}
    .tag{display:inline-block;padding:5px 12px;border-radius:999px;background:${accent};color:#fff;
         font-size:15px;font-weight:500;letter-spacing:.4px}
    h1{font-size:52px;line-height:1.22;color:${fg};font-weight:500;margin:22px 0 18px;letter-spacing:-.5px}
    p{font-size:20px;line-height:1.75;color:${sub};margin-bottom:10px}
    .feats{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}
    .feats span{padding:7px 14px;border-radius:8px;border:1px solid ${dark ? '#2f3540' : '#d8dde5'};
         background:${card};color:${dark ? '#b9c2d0' : '#3a4354'};font-size:15px}
    .foot{margin-top:30px;font-size:15px;color:${sub};font-family:ui-monospace,Menlo,Consolas,monospace}
    .right{width:340px;flex:none;display:flex;align-items:center;justify-content:center}
    /* 按高度约束而不是按宽度：面板图是 320x640 的细长比例，只固定宽度会让它
       超出 640px 画布高度、被裁掉一截。max-height 保证整张图都进画面。 */
    .right img{max-height:560px;max-width:300px;width:auto;height:auto;
         border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,${dark ? '.55' : '.18'})}
  </style></head><body>
    <div class="left">
      <span class="tag">Tampermonkey 用户脚本</span>
      <h1>公务员网络培训助手</h1>
      <p>自动作答试卷 · 解除播放失焦暂停 · 本地题库</p>
      <div class="feats">
        <span>多省份适配</span><span>${bankCount} 条内置题库</span>
        <span>按钮式面板</span><span>内置自检 ${selfTestCount} 项</span>
      </div>
      <div class="foot">v${version} · MIT · 单文件无依赖</div>
    </div>
    <div class="right"><img src="file://${panelAbs}" alt=""></div>
  </body></html>`;
}

// ---------------------------------------------------------------- 渲染
function shot(html, out, w, h, scale) {
  const page = join(TMP, `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
  writeFileSync(page, html, 'utf8');
  // DEBUG_SHOT=1 时保留页面并打印控制台，用于排查「图里元素是空的」
  if (process.env.DEBUG_SHOT) {
    const dom = execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      `--window-size=${w},${h}`, '--virtual-time-budget=14000', '--dump-dom', `file://${page}`,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('[DEBUG] 页面保留在', page);
    return;
  }
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--window-size=${w},${h}`, `--force-device-scale-factor=${scale}`,
    '--virtual-time-budget=14000', `--screenshot=${out}`, `file://${page}`,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  rmSync(page, { force: true });
}

function toWebp(png, webp, quality) {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', png, '-quality', String(quality), webp],
    { stdio: ['ignore', 'pipe', 'inherit'] });
}

// 面板特写与法宣同形态（只截面板、2 倍缩放）。尺寸比法宣略高：
// 本脚本比它多一个「观看限制」分类，日志按钮也多一颗。
// 先落到临时 PNG 再转 webp：Chrome 不能直接截 webp。
const panelWebp = join(ROOT, 'docs', 'panel.webp');
console.log('渲染面板…');
const panelPng = join(TMP, 'panel.png');
shot(panelHtml(), panelPng, 320, 640, 2);
toWebp(panelPng, panelWebp, 92);

for (const dark of [false, true]) {
  const name = dark ? 'social-preview-dark' : 'social-preview-light';
  const png = join(TMP, name + '.png');
  console.log(`渲染 ${name}…`);
  shot(socialHtml(dark), png, 1280, 640, 1);
  toWebp(png, join(ROOT, 'docs', name + '.webp'), 88);
}

rmSync(TMP, { recursive: true, force: true });
console.log('\n完成：');
console.log('  docs/panel.webp');
console.log('  docs/social-preview-light.webp');
console.log('  docs/social-preview-dark.webp');
console.log('\n下一步：到 GitHub Settings → Social preview 重新上传浅色版（OG 不会随 README 自动更新）。');
