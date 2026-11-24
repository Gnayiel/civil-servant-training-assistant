# 发版流程

> 面向有写权限、负责打 tag 与发布 Release 的维护者。日常开发与测试见 [docs/DEVELOPMENT.md](DEVELOPMENT.md)；仓库侧的 rulesets、Actions 权限与安全设置见 [docs/REPOSITORY_SETTINGS.md](REPOSITORY_SETTINGS.md)，那些设置需要在 GitHub 网页上人工确认。

## 版本号

版本号只有一个事实来源：用户脚本头部的 `// @version`。其余位置都是它的副本，发版时必须同步：

| 位置 | 写法 | 校验方式 |
| --- | --- | --- |
| `civil-servant-training-assistant.user.js` | `// @version x.y.z` | 唯一来源 |
| `package.json` | `"version": "x.y.z"` | `tests/selftest.mjs` 与 `tools/release.mjs` 断言一致 |
| `README.md` | `badge/version-x.y.z-` 徽章 | `tools/release.mjs` 断言一致 |
| `CHANGELOG.md` | `## vx.y.z` 一节 | 发版门禁要求该节正文非空且含分类标题 |
| git tag | `vx.y.z` | 必须与 `@version` 完全一致（`--check-ci` 校验） |

规则：

- 语义化版本：修 bug 升 patch，向后兼容的新能力升 minor，破坏兼容（存储格式、面板交互大改）才升 major。
- **只升不降**：新版本号必须大于已有最高 tag。`release.mjs` 会检查。
- 不要在 tag 已推送后补改文件再移动 tag：已安装用户的更新链会混乱。打错了就发一个更高的 patch。

## 发布前

按顺序完成，任何一项不通过都不要打 tag：

1. **版本与说明就位**：改 `@version`、`package.json`、README 徽章，在 `CHANGELOG.md` 写 `## vx.y.z` 章节（新增 / 变更 / 修复 / 验证方式），验证方式写真实跑出来的结果。
2. **配图同步**：`npm run docs:images`，确认三张图的版本号与题库数字正确；再到 GitHub **Settings → Social preview** 重新上传。原理见 [IMAGE_PIPELINE.md](IMAGE_PIPELINE.md)。
3. **统一门禁全绿**：`node tools/ci.mjs --strict`（7 步，含浏览器冒烟）。不要用 `--no-smoke` 的结果代替发布前门禁。
4. **发版门禁自检**：`node tools/release.mjs --dry-run`，确认输出通过。
5. **工作区干净**：`git status --porcelain` 为空。
6. **体积检查**：脚本预算 260 KB，`selftest` 与 `release.mjs` 都会断言。
7. **外链复核**（可选，需要网络）：`node tools/check-external-links.mjs --strict`。

## 本地流程

```bash
# 1) 提交并先推 main（release.yml 会校验 raw main 已经是本版）
git add -A
git commit -m "release: vx.y.z - 一句话说明"
git push origin HEAD:main

# 2) 本地打 tag：版本单调、工作区干净、跑统一门禁，然后打 annotated tag
node tools/release.mjs

# 3) 只推这一个 tag（不要 git push --tags）
git push origin vx.y.z
```

手工等价流程：

```bash
git tag -a vx.y.z -m "vx.y.z"
git push origin vx.y.z
```

约束：

- **先推 main，再推 tag**。`release.yml` 会用 raw main 判断「main 是否已跟上 tag」，main 落后时发版会红。
- `release.mjs` 只打本地 tag，**不 push**；唯一联网动作是带 20 秒超时的 `git fetch --tags`。
- 一次只推一个 tag。`git push --tags` 会把本地遗留的旧 tag 一起推上去，可能触发多次发版。
- 重复执行安全：tag 已存在时只提示并退出 0，不会重复打 tag。

### 本机没有 git 时

这台开发机装不了 git（系统目录只读）。可用仓库自带的 REST API 推送工具：

```bash
GITHUB_TOKEN=xxx node tools/push-to-github.mjs --owner Gnayiel
```

它把全部文件打成一个提交。**但它不创建 tag、不跑 `release.mjs`**，所以完整发版仍需一台有 git 的机器，或在 GitHub 网页上手工建 tag + Release。详见 [DEVELOPMENT.md](DEVELOPMENT.md#没有-git-时怎么推)。

### SSH 推不上去（22 端口被拦）

```
# ~/.ssh/config
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

然后 `ssh -T git@github.com` 验证。`https://` 远端不受影响。

## release.yml 做什么

推送 `v*` tag 会触发 `.github/workflows/release.yml`（workflow 名「发版」）。拆成两个 job：

- `verify`（只读）先跑 tag/版本/CHANGELOG 门禁与完整自检；失败时 `release` 不会启动。
- `release`（`needs: verify`，只在发布 job 内申请最小写权限）生成校验和、发布 Release、回读校验与更新链检查。

| 步骤 | job | 内容 | 失败后果 |
| --- | --- | --- | --- |
| 1. 校验 tag 与版本 / CHANGELOG | verify | `node tools/release.mjs --check-ci "$TAG"` | 不创建 Release，tag 保留 |
| 2. 发版前自检 | verify | `node tools/ci.mjs --strict` | 不创建 Release，tag 保留 |
| 3. 生成校验和与发布说明 | release | `sha256sum` 生成 `.sha256`；`awk` 抽取 CHANGELOG 正文并校验非空 | 中止 |
| 4. 生成构建来源证明 | release | `actions/attest-build-provenance` 对 `.user.js` 生成来源证明 | 中止 |
| 5. 创建或更新 Release | release | `gh release create`，或对已存在的 Release `edit --draft=false` + `upload --clobber` | Release 可能已存在，修好后重跑 |
| 6. 验证 Release | release | 回读 `isDraft=false`、附件数为 2、`sha256sum -c`、`cmp` 与复算 | 报错并提示重跑 |
| 7. 更新链校验 | release | purge jsDelivr；以 raw main 为权威重试 6×20 秒；镜像未刷新只告警；latest 必须指向本 tag | raw 未跟上或 latest 不对会红 |

权限与并发：

- workflow 顶层 `permissions: contents: read`；`verify` 继承只读；`release` 显式声明 `contents: write`、`id-token: write`、`attestations: write`。
- 两个 job 都在 `ubuntu-24.04` 上跑。`verify` 用 `fetch-depth: 0`，`release` 用 `fetch-depth: 1`；都设 `persist-credentials: false`。
- 全局并发组 `release`，`cancel-in-progress: false`：两个 tag 同时发版会排队。
- 所有第三方 action 都 pin 到 40 位 commit SHA，升级由 Dependabot 开 PR。

## 更新链

| 入口 | 地址 | 特点 |
| --- | --- | --- |
| 油猴自动更新 | `@updateURL`：`cdn.jsdelivr.net/gh/<repo>@main/...` | 分支缓存 **12 小时** |
| 固定版本安装 | `fastly.jsdelivr.net/gh/<repo>@vx.y.z/...` | 钉死到 tag，不受分支缓存影响 |
| 权威版本判定 | `raw.githubusercontent.com/<repo>/main/...` | 无长缓存，发版门禁用它判断 main 是否跟上 |
| Release 附件 | Releases 页的 `.user.js` 与 `.sha256` | 离线安装与校验 |

**为什么 `@updateURL` 用 `@main` 而不是 `@latest`**：jsDelivr 的分支缓存是 12 小时，版本别名（含 `latest`）是 7 天，精确 tag/commit 是永久。`@main` 已经是「能自动更新」里最快的通道。

因此发布顺序必须是：先推 main（raw 跟上）→ 再推 tag（workflow 建 Release）→ latest 指向新 tag。镜像没刷新只会 `::warning::`，不卡发版；急着验证用 `@vx.y.z` 固定链接。

## 失败恢复

| 场景 | 处理 |
| --- | --- |
| `--check-ci` 报 tag 与 `@version` 不一致 | 改版本号或改 tag；**tag 未推送**时可 `git tag -d` 后重来 |
| CHANGELOG 缺失或章节为空 | 补 `## vx.y.z` 正文，提交并推 main，再发新 tag |
| 本地门禁失败 | 修代码后重新提交；不要带着红灯打 tag |
| Release 已创建但验证失败 | 按报错修，然后在 Actions 里重跑同一 tag 的 workflow |
| raw main 版本未跟上 tag | 确认 main 已包含本版脚本；workflow 会重试 6 次 |
| 镜像仍旧版 | 正常缓存延迟；用固定 `@vx.y.z` 链接验证，或等 12 小时 |
| latest 不是本 tag | 到 Releases 页把 `vx.y.z` 设为 latest，再重跑 workflow |
| tag 打错且已推送 | **不要删除或强推移动已推 tag**。发一个更高的 patch |

补充：

- 不要为了「让 CI 变绿」而删除失败的 tag 或 Release 资产；已安装用户可能已拿到该版本。正确做法是发新补丁并在 CHANGELOG / Release 说明里写清问题。
- 如果 Release 已存在但内容错误，workflow 会 `edit --draft=false` 并用 `--clobber` 覆盖两个附件。

## 发布后验证

1. Actions 里「发版」workflow 全绿，尤其第 5、6、7 步没有跳过。
2. Releases 页：`vx.y.z` 是 latest，标题与正文正确，恰好两个附件，说明里有体积与 SHA256。
3. 下载附件并复算：

   ```bash
   sha256sum -c civil-servant-training-assistant.user.js.sha256
   # Windows: Get-FileHash .\civil-servant-training-assistant.user.js -Algorithm SHA256
   ```

4. 在干净的浏览器配置里用固定版本链接安装，确认油猴显示 `@version` 为 `x.y.z`，页面能正常出面板。

## 回滚策略

- **回滚 = 发一个更高的 patch 版本**：revert 或修正后按本文流程发 `x.y.(z+1)`，CHANGELOG 写清「回滚了哪个版本、影响是什么、建议升级」。
- **不删除、不移动已发布的 tag**；也尽量不要删除 Release 资产。固定版本链接与用户已安装的版本都依赖它们。
- 如果问题只影响说明文字，可以编辑 Release 正文加警告；脚本本身有问题时，仍以发新补丁为准。

## 仓库保护依赖

以下 GitHub 设置会影响发版安全，但**不在 git 里**，也无法由本文保证已开启；请按 [REPOSITORY_SETTINGS.md](REPOSITORY_SETTINGS.md) 在网页上确认：

- `protect-release-tags`：阻止 `v*` tag 被删除或改指向。
- `protect-main`：需要服务端拦截时启用 PR 规则与 required checks（`selftest (22)` 与 `selftest (24)`）。
- Actions 默认权限为 read；只有 `release` job 声明写权限。
- Releases 的 latest 指向与附件保留策略。
