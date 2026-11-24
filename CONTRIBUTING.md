# 参与贡献

感谢愿意帮忙。这个项目的维护成本主要集中在**平台改版后的选择器修复**和**题库补充**两件事上，两者都不需要读懂全部代码。

## 报告问题前

先确认三件事，能省掉一轮往返：

1. 脚本版本（面板标题旁的 `vX.Y.Z`）
2. 面板「日志」里的最后十几行，尤其是 `解析到 N 道题` 与 `无可用答案`
3. 页面类型：试卷页 / 播放页 / 课程列表

涉及页面结构的，附一段脱敏后的 HTML（题干可以留，姓名、单位、`token`、`JSESSIONID` 必须去掉）。

## 三类常见问题

| 现象 | 多半是 | 改哪里 |
| --- | --- | --- |
| 解析出 0 题 | 试卷容器类名变了 | `SEL.typeBlock` / `SEL.typeTitle` |
| 题型判错（多选当单选） | 控件类型或 `name` 前缀变了 | `parseQuestion` 里的题型判定 |
| 选项文本错位 | `dd` 结构变了 | `SEL.optionDd` |
| 播放还是会暂停 | 平台换成了 `addEventListener` | `playerGuard.install` |
| 交卷没反应 | 提交字段或返回文案变了 | `submitExam` / `hookSubmitAlert` |

改选择器时**只动 `SEL`**。把页面结构知识散落到流程控制里，下次改版会加倍还债。

## 提 PR 之前

```bash
node tools/ci.mjs            # 统一门禁：7 步
node tools/ci.mjs --strict   # 要求必须有浏览器（涉及页面逻辑的改动必跑）
```

要求全绿。没有浏览器时冒烟测试会自动跳过，但涉及页面逻辑的改动请本地跑一次 `--strict`。

CI 会在 Node 22 上跑完整门禁、Node 24 上跑快速门禁。第三方 action 都 pin 到 commit SHA，
不要改成 `@v4` 这类可变标签——`tools/check-workflows.mjs` 会拦下来。

如果改了题库或数据文件，`npm test` 会校验脚本内嵌的 `SEED_RAW` 与 `data/bank-seed.json` 是否一致——忘了同步会直接失败，这是故意的。

## 新增省份适配

这是本项目最欢迎的贡献类型。做法见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#新增省份的步骤)，核心是三步：

1. 在脚本的 `SITES` 数组里加一项（`hosts`、`label`、`playerPath`、`listPath`、`sel`）；
2. 脚本头补该省份的 `@match` 与 `@connect`；
3. 在 `tests/fixtures/` 放一份该省份的试卷结构快照，并在 `page-smoke.mjs` 加一轮断言。

第 3 步不能省：同构平台的小差异（选项容器换个类名、判断题少包一层）只有真实页面才能暴露。

如果结构完全一致，只改 `hosts` 即可，`sel` 直接复用 `BASE_SEL`。

## 补题库

不需要写代码：

1. 在浏览器打开某门课的考试页，`Ctrl+S` 保存为「仅 HTML」
2. `node tools/parse-saved-paper.mjs 保存的文件.html` 得到题目 JSON
3. 人工填答案后合入 `data/bank-seed.json`
4. `node tools/sync-seed.mjs` 把答案同步进脚本
5. `npm test` 验证

答案以**选项文本**为准，字母只是辅助——平台会打乱选项顺序，只存字母迟早错位。

## 不接受的改动

以下方向即使 PR 质量很高也不会合并，请不要花时间：

- 伪造学习时长（伪造 `Sessiontime`、倍速、跳播、直接调 `AddCourse` 刷学时）
- 破解或绕过登录验证码
- 多账号批量刷课、并发多开
- 采集或上传用户数据、加入任何统计埋点
- 引入构建步骤或第三方运行时依赖（保持单文件是刻意的，见 `docs/ARCHITECTURE.md`）

## 提交信息

`type: 简述`，type 取 `feat` / `fix` / `docs` / `test` / `chore`。示例：

```
fix: 多选题残留选项未清除导致重复提交
docs: 补充试卷页 DOM 层级图
```

## 代码风格

- 2 空格缩进，单引号，语句带分号
- 单文件内用 `// ==================== 名称 ====================` 分段
- 新增判断逻辑优先写成纯函数并加进脚本内的 `selfTest()`，Node 自检与浏览器内自检跑的是同一批用例
- 改判断逻辑时不要只看「代码对不对」，要问「哪条断言能证明它对」
- 动态文本一律 `textContent`，`innerHTML` 只用于静态模板
