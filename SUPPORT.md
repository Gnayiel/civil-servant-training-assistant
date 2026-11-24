# 支持

这是一个个人维护的开源项目，没有客服团队，也不承诺固定响应时间。提问前请先按下面自查，能解决大部分「脚本没反应 / 不自动答」的问题。

## 先自查

1. **确认版本**：面板标题栏或油猴「已安装脚本」里显示的 `@version` 是否为最新版。旧版可能已经被平台改版影响；升级方法见 [README.md](README.md#关于自动更新)。
2. **看常见问题与已知限制**：[README.md](README.md#常见问题) 覆盖了安装、更新、AI 配置、平台适配范围、某题没有答案等高频情况。
3. **看面板日志**：面板「日志」里先看红色错误与 `warn`，很多失败（例如接口 401、页面未识别、令牌缺权限）日志里已写明原因。
4. **导出诊断包**：面板「日志 → 诊断包」生成的 JSON 含版本、适配层命中数、题库计数与脱敏日志，**不含 token 与个人信息**。报问题时优先附它，比截图有用。
5. **最小化复现**：暂时关闭其它油猴脚本、换一个浏览器配置或无痕窗口再试，确认不是扩展冲突。
6. **确认范围**：脚本只适配 README「支持范围」里列出的平台。域名不在 `SITES` 里、页面结构也不像培训平台时，脚本会静默退出，不建面板——这是有意设计，不是 bug。

## 该去哪里

| 情况 | 渠道 |
| --- | --- |
| 脚本 bug（报错、解析失败、导入导出异常、平台改版失配） | [提交 Issue](https://github.com/Gnayiel/civil-servant-training-assistant/issues/new/choose)，选择「缺陷报告」模板 |
| 功能建议 / 改进想法 | [功能建议模板](https://github.com/Gnayiel/civil-servant-training-assistant/issues/new?template=feature_request.yml)；方向不确定可先到 Discussions |
| 使用问题、求脚本、刷课刷视频等非 bug 讨论 | [GitHub Discussions](https://github.com/Gnayiel/civil-servant-training-assistant/discussions) |
| 安全问题、疑似凭据泄露 | **不要发公开 issue**，按 [SECURITY.md](SECURITY.md) 走私密报告 |
| 想贡献代码或文档 | 先读 [CONTRIBUTING.md](CONTRIBUTING.md)；开发与测试见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |

仓库已关闭空白 issue，必须选择模板；与项目无关的「求脚本 / 刷课」类请求会被关闭。

## 提问需要附带的材料

按模板填写即可，信息越具体处理越快：

- **脚本版本**：例如 `1.1.1`（不要写「最新版」）。
- **浏览器与版本**：Edge / Chrome / Firefox 的具体版本。
- **脚本管理器与版本**：Tampermonkey / Violentmonkey 的具体版本。
- **出问题的位置**：试卷页 / 播放页 / 面板本身 / 题库导入导出。
- **复现步骤**：从打开页面到出问题的每一步。
- **期望行为与实际行为**：一句话说明「应该怎样、实际怎样」。
- **诊断包 JSON**：面板「日志 → 诊断包」直接导出；已脱敏，不含 token 与 API Key。
- **截图**：可选，注意遮住姓名、单位、成绩等个人信息。

## 不要贴出来的内容

- **AI 接口的 API Key**、`Authorization` 头、完整请求体。
- 账号、密码、Cookie、身份证号、姓名、单位等个人信息。
- 未脱敏的完整 URL（可能带 token / 查询参数）；诊断包已做脱敏，优先用它。
- 他人的成绩单、答题记录截图（除非已彻底打码）。

如果怀疑 Key 已泄露：立即到对应服务商后台吊销并重新生成；不要在 issue 里补发旧 Key。

## 响应预期

- 这是个人项目，维护者利用业余时间处理，**不承诺固定时限**，也不保证每个问题都能修（例如平台改版、地区差异、浏览器策略限制）。
- 提交前请确认已看过常见问题；重复提问可能会被合并或关闭。
- 修复发布后会在 [CHANGELOG.md](CHANGELOG.md) 与 Releases 中说明；升级方式见 [README.md](README.md#关于自动更新)。

## 自己动手

如果你能定位问题，欢迎直接提 PR：

- 开发环境、命令与门禁：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 代码与提交约定：[CONTRIBUTING.md](CONTRIBUTING.md)
- 发版规则：[docs/RELEASING.md](docs/RELEASING.md)

即使不写代码，提供一个脱敏后的页面 DOM 片段、诊断包和稳定复现步骤，也是对修复最大的帮助。
