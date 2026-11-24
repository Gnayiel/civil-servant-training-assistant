# 开发与测试

## 环境

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| Node.js | ≥ 22 | 跑检查与测试，只用内置模块 |
| Chromium / Chrome | 任意近期版本 | 页面冒烟测试（可选） |

不需要 `npm install`——本项目没有依赖。装 Node 就能跑全部静态检查。

浏览器查找顺序：`$CHROME_BIN` → 常见安装路径 → `command -v`。找不到时冒烟测试自动跳过。

## 命令

```bash
node --check civil-servant-training-assistant.user.js   # 单文件语法
node tests/selftest.mjs                     # 元数据 + 纯函数自检 + 题库一致性
node tools/check-data.mjs                   # 数据完整性与覆盖率
node tools/check-docs.mjs                   # 链接、围栏、文档数字
node tools/check-syntax.mjs                 # 全仓库 .mjs 与用户脚本语法
node tools/check-workflows.mjs              # CI 配置引用的脚本是否存在
node tests/page-smoke.mjs                   # 离线 fixture 的端到端冒烟
node tools/ci.mjs                           # 以上全部串起来
node tools/ci.mjs --strict                  # 要求必须有浏览器
```

`package.json` 里另有等价入口：`npm test`、`npm run check`、`npm run smoke`、`npm run ci`。

## 测试分层

| 层 | 文件 | 依赖 | 覆盖 |
| --- | --- | --- | --- |
| 内置自检 | 脚本内 `selfTest()` | 无 | 归一化、指纹、相似度、CSV 解析等纯函数 |
| Node 自检 | `tests/selftest.mjs` | Node | 元数据、权限、体积、安全基线、题库与脚本内嵌数据一致 |
| 数据检查 | `tools/check-data.mjs` | Node | 题型合法、答案属于该题选项、字母与文本对齐、覆盖率 |
| 文档检查 | `tools/check-docs.mjs` | Node | 相对链接、代码围栏、README 数字与数据文件一致 |
| 页面冒烟 | `tests/page-smoke.mjs` | Chromium | 真实结构 fixture：解析 5 题、逐项填答、多选收窄、blur 拦截、诊断包结构 |

页面冒烟的机制：把 `tests/fixtures/*.html` + 用户脚本 + 探针脚本拼成临时页面，用 `chrome --headless --virtual-time-budget --dump-dom` 跑完，再从 `<pre id="__r">` 把 JSON 读回来断言。没有 WebSocket / CDP 依赖，因此不引入任何 npm 包。

## fixtures 维护

`tests/fixtures/exam-paper.html` 是 `courseId=1246` 试卷的结构快照（含单选 2、多选 1、判断 2），保留了平台 `gradeExamInfo.js` 里被 `onclick` 调用的 `danxOnClick` / `duoxOnClick` 两个函数——缺了它们，点击选项会抛 `ReferenceError`，测试就测不到真实交互。

平台改版时：

1. 浏览器打开试卷页，`Ctrl+S` 存「仅 HTML」
2. 裁出 `form#examInfoFrom` 与 `div.shiti`，替换 fixture 里的对应部分
3. 补上新的 `onclick` 处理函数（旧的可以留）
4. 更新 `page-smoke.mjs` 里 `EXPECT` 的期望值与题号
5. `npm run smoke`

`tests/fixtures/player.html` 复刻播放页的 `window.onblur` 与最小播放器结构。页面会被写进 `.tmp-smoke/gansu-spcrm/videoPlayGJ/`，这样 `isPlayerPage()` 的路径判定也被真实覆盖。

## 更新题库

平台每期会换课，题库需要增量补充。**不需要登录脚本，也不该把账号密码写进任何文件。**

1. 浏览器打开某门课的考试页，`Ctrl+S` 保存为「仅 HTML」
2. 解析成题目列表：

   ```bash
   node tools/parse-saved-paper.mjs ~/Downloads/gradeExamInfo.html > /tmp/q.json
   ```

3. 人工判定答案，按 `[题型, 题干, 答案文本[], 答案字母[]]` 补进 `data/bank-seed.json`
4. 同步进脚本：

   ```bash
   node tools/sync-seed.mjs
   ```

5. `npm test` 验证一致性与答案合法性

新题还要补进 `data/questions-unique.json`（`parse-saved-paper.mjs --merge` 会按题干去重追加），否则「题库题干必须来自抓取到的试卷」这条检查会失败。

判答案的原则：

- 以**选项文本**为准，字母只作辅助
- 拿不准的宁可不收录——留空只是跳过该题，写错会直接填错
- 判断题优先核对可查证的数据，不要凭语感

## 发布

版本号有四个副本，必须同步：

1. 脚本头 `@version`
2. `package.json` 的 `version`
3. `CHANGELOG.md` 新增条目
4. Git tag `vX.Y.Z`

`tests/selftest.mjs` 会比对 1 与 2，`tools/check-docs.mjs` 会核对 3，漏改会失败。

## 没有 git 时怎么推

环境里没有 git（或不想在工作区留 `.git`）时，用 REST API 直接推：

```bash
GITHUB_TOKEN=xxx node tools/push-to-github.mjs --owner <用户名> [--repo <仓库名>] [--dry]
```

它读取与 `.gitignore` 一致的排除规则，把文件打成**一个提交**（不是逐文件提交），
顺带创建仓库、配置话题。

内置两道护栏，命中就拒绝推送：

- 路径级：`probe/`、`_ref/`、`.env`、`*.bak`
- 内容级：`JSESSIONID=`、会话 `token=`、`ghp_*` 令牌、`BEGIN PRIVATE KEY`

### 三个已知约束

1. **空仓库的 Git Data API 返回 409**（不是 404）。必须先通过 Contents API 落一个文件
   产生初始提交，之后才能建 blob。脚本已自动处理。
2. **`.github/workflows/` 下的文件需要 `workflow` 权限**。只有 `repo` 权限时，
   建 tree 会返回 **404 而不是 403**（GitHub 故意模糊化），Contents API 同样 404，
   没有绕过办法。脚本会自动剔除这两个文件继续推，并在结尾列出缺口。
   补法：重新生成经典令牌时勾选 `workflow`，或在网页上手工新建。
3. **新建仓库后有几秒复制延迟**，trees / commits 偶发 404。脚本对写操作做 4 次
   指数退避重试。

## 两个不入库的目录

仓库根下有两处本地目录，都写在 `.gitignore` 里：

| 目录 | 内容 | 为什么留着 |
| --- | --- | --- |
| `_ref/` | 「法宣在线」插件的完整实现，约 11 MB | 当初的架构参照，改脚本时对照用 |
| `probe/` | 探测期的抓取脚本、平台前端脚本副本、抓包结果 | 追溯题库来源；详见 `probe/README.md` |

`probe/` 里的会话 cookie 与 token 已清空内容。两者都可以直接删除，不影响脚本运行与 CI——所有检查只读 `data/`、`tests/`、`tools/`。

## 配图

`docs/panel.png` 由 `docs/mockup.html` 生成，不用设计工具：

```bash
# 1. 把脚本与一段隐藏的真实结构试卷 DOM 内联进 mockup，面板才会识别到题目
# 2. 用无头浏览器按 2 倍像素密度截图
chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1290,880 --force-device-scale-factor=2 \
  --virtual-time-budget=14000 --screenshot=docs/panel.png \
  file://$PWD/docs/mockup-live.html
```

要点：`--virtual-time-budget` 要大于脚本自动作答的等待时间（默认 1.2 秒起，含逐题间隔），否则截到的是空面板；`--force-device-scale-factor=2` 保证高分屏不糊。

改面板样式后重拍一次，顺手确认配图里的「题库 N 条」与 `data/bank-seed.json` 一致。

## 建仓清单

首次推到 GitHub 后按顺序做一遍，半小时内能完成：

1. **一次性替换占位符并配置自动更新**

   ```bash
   node tools/init-repo.mjs --owner <你的 GitHub 用户名>          # 先加 --dry 预演
   ```

   会改 `CHANGELOG.md` 的链接、Issue 模板的文档地址、`package.json` 的 repository 字段，
   并给脚本补上 `@updateURL` / `@downloadURL`。幂等，重复跑只补缺失项。
   不带参数执行会打印当前还差什么。

2. **仓库描述与话题**（About 右侧齿轮）：描述用 README 首行那句；话题建议
   `tampermonkey` `userscript` `automation` `gansu` `civil-servant`
3. **分支保护**：`main` 要求 CI 通过才能合并
4. **开启 Issues**，确认缺陷模板出现在「新建 issue」页
5. **打首个 tag**：`git tag v1.0.0 && git push --tags`，`release.yml` 会把脚本挂到 Release

改完元数据块记得再跑一次 `node tools/ci.mjs`——自检会核对 `@grant`、`@match` 与版本号，
别顺手改坏了。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `Alt+A` | 在当前页开始作答（只在试卷页有效） |
| `Alt+H` | 收起 / 展开面板 |
| `Alt+L` | 清空日志 |

输入框聚焦时不响应，避免打断面板里的接口设置。

## 排查

| 现象 | 先查 |
| --- | --- |
| 自检报「脚本内 N 条与文件不一致」 | 改了 `data/bank-seed.json` 但没跑 `sync-seed.mjs` |
| 冒烟测试超时无输出 | 临时页面被 CSP 拦；确认 `--virtual-time-budget` 大于探针的 `setTimeout` |
| 冒烟报「页面没有回传结果」 | 脚本在 boot 阶段抛错，加 `--enable-logging=stderr` 看控制台 |
| Node 自检报 `document is not defined` | 脚本的 `IS_BROWSER` 守卫被改坏，检查尾部提前返回逻辑 |
| 冒烟报「探针未回传结果」 | 探针脚本语法错误。**模板字符串里的 `\s` `\?` 会被 JS 吃掉一个反斜杠**，`/[^\s*]/` 变成 `/[^s*]/`、`/\?/` 变成非法量词。探针里别写正则，改用 `indexOf`，脱敏这类逻辑放 Node 自检 |
| 冒烟页面被留下没删 | 说明探针没跑完；用 `--dump-dom` 手动打开 `.tmp-smoke/` 下的文件看控制台 |
