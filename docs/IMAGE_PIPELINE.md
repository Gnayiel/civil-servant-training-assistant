# 文档图片生成说明

README 使用的三张图：

- `docs/panel.webp` — 面板特写（与法宣在线助手同一形态）
- `docs/social-preview-light.webp` — 仓库社交预览（浅色）
- `docs/social-preview-dark.webp` — 仓库社交预览（深色）

都是仓库内的脱敏复刻，不包含真实账号信息。版本号和题库条数会变，用脚本重新生成，避免手工维护漂移。

```bash
npm run docs:images

# 或显式指定版本
node tools/generate-docs-images.mjs --version 1.1.1
```

## 原理

面板图不是设计稿，而是**真的把脚本跑起来**再截图。形态与「法宣在线助手」的
`docs/panel.webp` 一致：**只截面板本身**，不叠试卷背景。

1. 页面里放一段 `display:none` 的最小试卷结构 —— 脚本有启动守卫，
   域名不在适配表、页面又看不出是培训平台时会静默退出，不给这段结构就没有面板；
2. 把用户脚本**内联**进去，它自己会创建面板并读真实题库；
3. 面板在脚本里是 `position: fixed` 挂右上角的。配图要它成为画面主体，
   所以往**影子根内**注入一段样式把它改成 `position: static`。
   外部 `<style>` 一律进不了 Shadow DOM —— 这是本项目最容易踩的坑；
4. 截图时视口故意给大（380×760 @2x），再用 ImageMagick `-trim` 按实际像素**裁掉多余背景**，
   最后统一加 16px 边框。视口尺寸是估的，估大了是一圈不匀的黑边、估小了面板会被裁掉一角，
   按像素裁才两头都稳。最终输出约 632×1298。

尺寸比法宣（316×561）略高：本脚本比它多一个「观看限制」分类、日志行也多一颗按钮。

演示日志每条都控制在一行内 —— 日志框是等宽字体 + 定宽面板，多一个字就折行，
图上像被截断。

社交预览是独立 HTML：左侧标题与特性标签，右侧嵌入刚生成的面板图（按 `max-height` 缩放，
不能只固定宽度，否则细长的面板图会被 640px 的画布裁掉），1280×640 截一次，再用 ffmpeg 转 WebP。

## 面板文案不带 emoji（有意为之）

统计行与日志都是纯文本。曾经加过 `📊 题库 N 题 · 💾 x KB` 这类装饰，代价是：
无头浏览器要额外装 emoji 字体、字体栈顺序写错会让**整段中文不绘制**、
`@font-face` 的 `block` 与 `swap` 在虚拟时间下分别导致「全空白」与「永远方块」，
而文档级选择器又进不了影子根。去掉之后任何机器渲染结果都一样，也与法宣成品一致。

## 依赖

| 工具 | 用途 | 指定方式 |
| --- | --- | --- |
| Chrome / Chromium | 渲染截图 | `CHROME=/path/to/chrome` |
| ffmpeg | PNG → WebP | `FFMPEG=/path/to/ffmpeg` |
| 中文字体 | 否则中文显示为方框 | 系统安装即可（**不需要** emoji 字体） |
| ImageMagick | 面板图裁边（`-trim`） | `MAGICK=/path/to/magick`；缺了只警告、不中断 |

缺 Chrome 或 ffmpeg 时脚本直接报错退出，不会产出半成品。

## 数字从哪来

脚本自动读取，**不要手改**：

| 数字 | 来源 |
| --- | --- |
| 版本号 | `package.json` 的 `version`（可用 `--version` 覆盖） |
| 题库条数 | `data/bank-seed.json` 的长度 |
| 覆盖率 | `bank-seed.json` / `questions-unique.json` |
| 自检项数 | 用户脚本里 `eq(...)` 的调用次数 |

## 发版检查清单

1. 改版本号或换题库后执行 `npm run docs:images`，用图片查看器确认三张图的版本号与数字正确；
2. `node tools/ci.mjs` 全绿；
3. 到 GitHub **Settings → Social preview** 重新上传 `docs/social-preview-light.webp`（或深色版）——OG 图是独立设置，不会随 README 自动更新；
4. `node tools/release.mjs --dry-run` 通过后再发版。

若调整海报布局，改 `tools/generate-docs-images.mjs` 里的 `socialHtml()`；若调整面板演示状态，改 `panelHtml()`。不要改坐标去覆盖旧图上的文字。
