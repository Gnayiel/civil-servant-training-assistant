# 仓库设置建议

> **本文所有设置均为建议，需要在 GitHub 网页上人工确认，不代表当前仓库已经这样配置。** 适用于仓库管理员 / owner。仓库侧的 rulesets、Actions 权限等不在 git 里，无法通过代码评审保证。

仓库：`Gnayiel/civil-servant-training-assistant`（公开仓库，MIT，纯单文件 userscript，无 npm 依赖）。

## 基本信息

| 设置 | 建议 | 说明 |
| --- | --- | --- |
| Description | `Tampermonkey 用户脚本：公务员网络培训平台通用助手，自动答题 + 解除播放失焦暂停 + 本地题库` | 已配置；`package.json` 用同义短描述 |
| Website | `https://github.com/Gnayiel/civil-servant-training-assistant/releases/latest` | 没有官方站点时指向最新 Release |
| Topics | `tampermonkey`、`userscript`、`automation`、`civil-servant`、`training`、`question-bank`、`gansu` | 已配置 7 个。上限 20，不建议堆无关热门标签 |
| Social preview | 上传 `docs/social-preview-light.webp`（深色界面用户可换 dark 版） | **OG 图是独立设置，README 更新后必须手工重传** |
| Default branch | `main` | 所有 workflow 与文档都按 `main` 写 |
| Features → Issues | 开启 | 需要 `bug_report.yml` / `feature_request.yml` 模板 |
| Features → Discussions | 建议开启（Q&A / 使用交流） | [SUPPORT.md](../SUPPORT.md) 与 issue 模板的 config 已分流 |
| Features → Wiki | 关闭 | 文档统一放 `docs/`，Wiki 容易与仓库文档分叉 |
| Features → Projects | 关闭 | 单人维护，issue/PR 足够 |

README 已链接架构、开发、发版、仓库设置与支持文档；改仓库名或默认分支时，记得同步 README 里的安装链接。

## Actions 权限

在 **Settings → Actions → General** 确认：

- **Workflow permissions**：默认 `Read repository contents and packages permissions`。`release.yml` 的 `verify` job 只读，只有 `release` job 声明 `contents: write`（及来源证明所需的 `id-token` / `attestations`）；`selftest.yml` 只需 `contents: read`。
- **Allow GitHub Actions to create and approve pull requests**：关闭。workflow 不创建 PR（Dependabot 的 PR 由它自己开）。
- **Fork pull request workflows**：保持默认「需要批准后运行」，fork PR 不暴露 secrets——本仓库 CI 不需要任何 secret。
- **Self-hosted runners**：不使用；workflow 固定 `ubuntu-24.04`。

注意：`auto-merge.yml` 声明了 `contents: write`，用于在 Dependabot PR 的**全部 checks** 通过后执行 squash 合并。若组织策略限制写权限，自动合并会失败，但不影响「自检」与发版。

## 分支与 tag 保护（Rulesets）

优先使用 **Settings → Rules → Rulesets**，建议建两条：

### `protect-main`

- Target：`main`。
- 要求通过 pull request 合并；单人仓库 approval 可设 0，但若要让 CI 成为服务端门禁，**必须**同时勾选 required status checks。
- Required checks：`selftest (22)` 与 `selftest (24)`（`selftest.yml` 的 Node 22/24 矩阵；22 跑完整门禁，24 跑快速门禁，check-run 名称不变。不要写成 `自检 / selftest (22)`，那只是展示串）。
- 阻止 force push、阻止删除分支。
- 要求对话解决后再合并。

> 当前仓库只启用了「阻止删除」与「阻止强推」。**main 允许直接 push**，因此实际门禁是发版前本地跑的 `node tools/ci.mjs`，不是 GitHub 的合并拦截。不要在文档里声称 required checks 已生效。

### `protect-release-tags`

- Target：tag 模式 `v*`。
- 阻止删除、阻止更新（移动/强推）已存在的 tag。
- 启用后「删除 tag 再重打」会被拒绝，这正是发版流程假设的行为。

## 合并与发布

- **Merge 方式**：只保留 `Squash merging`，保持 `main` 线性、每个 PR 一个提交。
- **Automatically delete head branches**：开启。
- **Allow auto-merge**：开启（Dependabot PR 的全绿后由 `auto-merge.yml` squash 合并）。
- **Releases → Enable immutable releases**（若可见）：建议开启，防止已发布附件被替换。
- **Releases → latest**：保持由 GitHub 自动指向最新非预发布 Release；发版 workflow 会校验 latest 指向当前 tag。

## Security

在 **Settings → Security** 确认：

- **Dependabot alerts** 与 **Dependabot security updates**：开启（本仓库只有 GitHub Actions 依赖，`.github/dependabot.yml` 已按周检查并分组）。
- **Code scanning（CodeQL default setup）**：建议开启，会跑 `Analyze (javascript-typescript)` 与 `Analyze (actions)`。
  **不要另加 `.github/workflows/codeql.yml`**——GitHub 不允许 default setup 与 advanced setup 同时启用。
- **Secret scanning** 与 **Push protection**：公开仓库建议开启。
- **Private vulnerability reporting**：开启。`SECURITY.md` 承诺通过 Security → Report a vulnerability 私密报告，未开启时这个入口不存在。
- **Security policy**：确认指向 `SECURITY.md`。

## 社区与协作

- **Issue 模板**：已有 `bug_report.yml`、`feature_request.yml` 与 `config.yml`；`config.yml` 已关闭空白 issue。
- **Discussions**：若开启，建议至少建 `Q&A` 与 `Announcements` 两个分类，并保持 [SUPPORT.md](../SUPPORT.md) 链接一致。
- **CODEOWNERS**：已有 `.github/CODEOWNERS`（`* @Gnayiel`）。
- **PR 模板**：`.github/pull_request_template.md` 已存在。

## 用 `gh` 核对（示例，需先安装并登录）

```bash
gh repo view Gnayiel/civil-servant-training-assistant --json description,repositoryTopics,homepageUrl
gh api repos/Gnayiel/civil-servant-training-assistant/rulesets
gh api repos/Gnayiel/civil-servant-training-assistant/actions/permissions
```

## 与文档的对应关系

| 设置 | 影响 | 相关文档 |
| --- | --- | --- |
| `protect-main` + required checks | 未过门禁的代码不能进 main | [DEVELOPMENT.md](DEVELOPMENT.md) 的统一门禁 |
| `protect-release-tags` | 已推 tag 不能删/改指向 | [RELEASING.md](RELEASING.md) 的失败恢复 |
| Actions 默认只读 | workflow 必须显式声明权限 | [RELEASING.md](RELEASING.md) |
| Private vulnerability reporting | `SECURITY.md` 的私密报告入口可用 | [SECURITY.md](../SECURITY.md) |
| Social preview | README 更新后分享卡片不会自动同步 | [IMAGE_PIPELINE.md](IMAGE_PIPELINE.md) |
| Immutable releases | 发布后附件不可覆盖 | [RELEASING.md](RELEASING.md) 的回滚策略 |
