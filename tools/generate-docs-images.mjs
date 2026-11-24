#!/usr/bin/env node
/**
 * 文档配图生成：把 docs/panel.png 与两张社交预览图从 HTML 重新渲染。
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
// 面板统计行与日志里有 emoji（📊 💾 🎛 ⏹️）。无头 Chromium 默认不带 emoji 字体，
// 缺字体时这些字符会渲染成豆腐块，README 第一张图就废了。
// 渲染时临时挂一个 Noto Emoji（只影响配图，不进仓库、不改脚本）。
// 放在 TMP 之外：脚本末尾会 rmSync(TMP) 清临时产物，字体若放里面，第二次运行就没了
const FONT_DIR = join(ROOT, '.tmp-font');
const EMOJI_FONT = join(FONT_DIR, 'NotoEmoji.woff2');
// file:// 页面用 @font-face 引 file:// 字体会被 CORS 拦下（无头 Chrome 同样如此），
// 所以字体必须以 data URI 内联进页面。
function emojiFontDataUri() {
  if (!existsSync(EMOJI_FONT)) {
    console.warn('缺少 emoji 字体，统计行里的 📊💾🎛 会渲染成方块；'
      + `下载到 ${EMOJI_FONT} 后重跑：\n`
      + '  mkdir -p .tmp-font && curl -sL -o .tmp-font/NotoEmoji.woff2 '
      + 'https://fastly.jsdelivr.net/npm/@fontsource/noto-emoji@5.0.0/files/noto-emoji-emoji-400-normal.woff2');
    return '';
  }
  return 'data:font/woff2;base64,' + readFileSync(EMOJI_FONT).toString('base64');
}

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
mkdirSync(FONT_DIR, { recursive: true });

// ---------------------------------------------------------------- 面板 HTML
// 复刻试卷版式 + 内联脚本 + 一段隐藏的真实结构试卷 DOM，
// 面板就会像在真实页面上一样识别到 5 题并自动作答。
function panelHtml() {
  const mockup = readFileSync(join(ROOT, 'docs', 'mockup.html'), 'utf8');
  const qs = uniq;
  const want = [
    '党的十七大提出将社会建设纳入总体布局',
    '新时代我国社会主要矛盾是',
    '居民可支配收入的构成包括',
    '平安中国建设的核心是满足人民的安全民生需求',
    '调节过高收入就是要打击所有高收入群体',
  ];
  const pick = [];
  for (const w of want) {
    const hit = qs.find((q) => q.q.startsWith(w));
    if (hit) pick.push(hit);
  }

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const groups = { single: [0, 1], multi: [2], judge: [3, 4] };
  const typeTitle = { single: '一、单选题', multi: '二、多选题', judge: '三、判断题' };

  let fake = '<form id="examInfoFrom" style="display:none">'
    + '<input type="hidden" name="courseId" value="1246">'
    + '<input type="hidden" name="testTime" value="10">'
    + '<input type="hidden" name="gradeId" value="15">'
    + '<input type="hidden" name="jsTime" value="00:00:00">'
    + '<div class="shiti"><div>';

  for (const [gtype, idxs] of Object.entries(groups)) {
    fake += `<div class="shiti_l"><h2>${typeTitle[gtype]}</h2>`;
    for (const i of idxs) {
      const q = pick[i];
      if (!q) continue;
      const prefix = { single: 'danxuan', multi: 'duoxuan', judge: 'panduan' }[gtype];
      const inp = gtype === 'multi' ? 'checkbox' : 'radio';
      fake += `<dl class="danxuan"><dt><span>${i + 1}.</span>${esc(q.q)}（20分）</dt>`;
      if (gtype !== 'judge') {
        q.opts.forEach((o, j) => { fake += `<dd>${String.fromCharCode(65 + j)}.${esc(o)}</dd>`; });
      }
      fake += '</dl><div class="xuxiang">';
      if (gtype === 'judge') {
        fake += `<label><input type="radio" name="${prefix}${q.qid}" value="1">对</label>`;
        fake += `<label><input type="radio" name="${prefix}${q.qid}" value="0">错</label>`;
      } else {
        q.opts.forEach((o, j) => {
          const L = String.fromCharCode(65 + j);
          fake += `<label><input type="${inp}" name="${prefix}${q.qid}" value="${L}">${L}</label>`;
        });
      }
      fake += '</div>';
    }
    fake += '</div>';
  }
  fake += '</div><div class="shiti_r"><span id="hh">00</span><span id="mm">09</span><span id="ss">47</span></div></div></form>';

  const stub = `<script>
window.GM_getValue=function(k,d){const v=localStorage.getItem(k);return v===null?d:JSON.parse(v);};
window.GM_setValue=function(k,v){localStorage.setItem(k,JSON.stringify(v));};
window.GM_info={script:{version:'${version}'}};
</script>
<style>
  @font-face{font-family:'NotoEmojiLocal';src:url('${emojiFontDataUri()}') format('woff2');font-display:block;}
  #csta-panel-host{right:26px!important;top:92px!important;bottom:auto!important;}
  /* 注意：面板在 Shadow DOM 里，这里的任何选择器都进不去。
     emoji 字体必须在影子根内部注入，见下面的 injectEmojiFont()。 */
</style>
<script>
// 面板在 Shadow DOM 里：文档级 @font-face 能被影子根引用，但字体栈必须写进影子根内部才生效。
function injectEmojiFont() {
  var host = document.getElementById('csta-panel-host');
  var root = host && host.shadowRoot;
  if (!root) return false;
  if (root.getElementById('__emoji')) return true;
  var st = document.createElement('style');
  st.id = '__emoji';
  // 只把 emoji 字体挂在字体栈末尾作兜底。若把它写在前头，汉字会因为没有对应
  // 字形而整段变成空白（上一版就是这样把面板渲染空的）。
  st.textContent = ''
    + '#fx-panel, #fx-panel *, #fx-panel .log-box, #fx-panel .log-line {'
    + 'font-family:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",'
    + '"Source Han Sans SC","Noto Sans CJK SC",sans-serif,"NotoEmojiLocal" !important;'
    + '}';
  root.appendChild(st);
  return true;
}
// 配图用固定演示日志：脚本真实启动日志里带着本机临时路径（.tmp-docs-images/xxx.html），
// 会被截图进 README。这里等脚本跑完后替换成一段干净、且能说明状态的演示日志。
window.addEventListener('load', function () {
  setTimeout(function () {
    injectEmojiFont();
    var host = document.getElementById('csta-panel-host');
    var box = host && host.shadowRoot && host.shadowRoot.querySelector('#fx-log');
    if (!box) return;
    var lines = [
      ['[10:12:03] 插件已加载 v${version} · 甘肃省', 'log-info'],
      ['[10:12:04] 检测到试卷，共 5 道题', 'log-info'],
      ['[10:12:05] 解析到 5 道题：单选题2 / 多选题1 / 判断题2', 'log-info'],
      ['[10:12:06] 第 9163 题作答（题库）：C', 'log-ok'],
      ['[10:12:07] 题库命中 5/5，已按节奏填答完成', 'log-ok'],
    ];
    box.innerHTML = lines.map(function (x) {
      var d = document.createElement('div');
      d.className = 'log-line ' + x[1];
      d.textContent = x[0];
      return d.outerHTML;
    }).join('');
  }, 2500);
});
</script>`;

  return mockup
    .replace('</head>', `${stub}</head>`)
    .replace('<body>', `<body>${fake}`)
    .replace('</body>', `<script>${userScript}</script></body>`);
}

// ---------------------------------------------------------------- 社交预览
function socialHtml(dark) {
  const bg = dark ? '#12151a' : '#eef1f5';
  const card = dark ? '#1b1e24' : '#ffffff';
  const fg = dark ? '#e7eaf0' : '#1a2130';
  const sub = dark ? '#8b95a8' : '#5d6675';
  const accent = '#2b5fd9';
  const panelAbs = join(ROOT, 'docs', 'panel.png');
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
    .right{width:340px;flex:none;display:flex;justify-content:center}
    .right img{width:300px;border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,${dark ? '.55' : '.18'})}
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

const panelPng = join(ROOT, 'docs', 'panel.png');
console.log('渲染面板…');
shot(panelHtml(), panelPng, 1320, 900, 2);

for (const dark of [false, true]) {
  const name = dark ? 'social-preview-dark' : 'social-preview-light';
  const png = join(TMP, name + '.png');
  console.log(`渲染 ${name}…`);
  shot(socialHtml(dark), png, 1280, 640, 1);
  toWebp(png, join(ROOT, 'docs', name + '.webp'), 88);
}

rmSync(TMP, { recursive: true, force: true });
console.log('\n完成：');
console.log('  docs/panel.png');
console.log('  docs/social-preview-light.webp');
console.log('  docs/social-preview-dark.webp');
console.log('\n下一步：到 GitHub Settings → Social preview 重新上传浅色版（OG 不会随 README 自动更新）。');
