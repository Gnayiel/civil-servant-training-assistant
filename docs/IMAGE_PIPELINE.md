# 文档图片生成说明

README 使用的三张图：

- `docs/panel.png` — 面板叠在试卷页上的演示图
- `docs/social-preview-light.webp` — 仓库社交预览（浅色）
- `docs/social-preview-dark.webp` — 仓库社交预览（深色）

都是仓库内的脱敏复刻，不包含真实账号信息。版本号和题库条数会变，用脚本重新生成，避免手工维护漂移。

```bash
npm run docs:images

# 或显式指定版本
node tools/generate-docs-images.mjs --version 1.1.1
```

## 原理

面板图不是设计稿，而是**真的把脚本跑起来**再截图：

1. `docs/mockup.html` 复刻试卷页版式；
2. 生成时把用户脚本**内联**进去，并追加一段**隐藏的真实结构试卷 DOM**（5 道真题，题号 9163–9167）；
3. 面板于是像在真实页面上一样识别到 5 题并自动作答；
4. `--force-device-scale-factor=2` 截 1320×900，输出 2 倍像素密度。

这样面板里的「作答 5/5」「题库 N 条」都是真实状态，不是画上去的。

社交预览是独立 HTML：左侧标题与特性标签，右侧嵌入刚生成的面板图，1280×640 截一次，再用 ffmpeg 转 WebP。

## 依赖

| 工具 | 用途 | 指定方式 |
| --- | --- | --- |
| Chrome / Chromium | 渲染截图 | `CHROME=/path/to/chrome` |
| ffmpeg | PNG → WebP | `FFMPEG=/path/to/ffmpeg` |
| 中文字体 | 否则中文显示为方框 | 系统安装即可 |

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
