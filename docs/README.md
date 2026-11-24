# 文档索引

本目录存放维护者与贡献者需要长期参考的文档。普通使用者先看仓库根目录的 [README.md](../README.md)；想直接安装，跳到 README 的「安装」章节即可。

## 从哪里开始

| 文档 | 面向 | 内容 |
| --- | --- | --- |
| [README.md](../README.md) | 使用者 | 功能、支持范围、安装与自动更新、使用说明、边界、常见问题 |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | 维护者 / 想改代码的人 | 多省份适配、运行时分段、页面 DOM 地图、答案数据流、反作弊拦截点、扩展点 |
| [docs/DEVELOPMENT.md](DEVELOPMENT.md) | 贡献者 / 维护者 | 开发环境、命令表、五层测试、fixture 维护、加断言、调试、配图、建仓清单、排查表 |
| [docs/RELEASING.md](RELEASING.md) | 发版维护者 | 版本号副本、发布前检查、本地发版流程、`release.yml` 的四道门禁、更新链、失败恢复、回滚 |
| [docs/REPOSITORY_SETTINGS.md](REPOSITORY_SETTINGS.md) | 仓库管理员 | 描述/topics/社交预览、Discussions/Wiki、Actions 权限、rulesets、Security、Releases（均为建议，需人工确认） |
| [docs/IMAGE_PIPELINE.md](IMAGE_PIPELINE.md) | 维护者 | 面板图与两张社交预览的生成方式、依赖、数字同步 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献者 | 贡献流程、改哪一层、测试要求、不接受的方向 |
| [SUPPORT.md](../SUPPORT.md) | 使用者 | 求助渠道、提问前自查、要附带的材料、不要贴的内容 |
| [SECURITY.md](../SECURITY.md) | 报告安全问题的人 | 权限范围、明确的非目标、已知风险、私密报告 |
| [CHANGELOG.md](../CHANGELOG.md) | 所有人 | 每个版本的变更分类与验证方式；版本号以脚本头部 `@version` 为准 |
| [data/README.md](../data/README.md) | 题库维护者 | 三份快照的字段、覆盖率、来源与边界、更新流程 |

## 文档维护约定

- **数字要同步**：README 徽章、CHANGELOG、`docs/` 里的断言数与题库条数必须一致。改数据或断言数后按 `docs/DEVELOPMENT.md` 的清单逐处更新；`tools/check-docs.mjs` 会核对 README 与 `data/` 是否一致。
- **相对链接必须能打开**：本地文档之间用相对路径（如 `DEVELOPMENT.md`、`../SECURITY.md`），不要写死分支或提交 URL；`node tools/check-docs.mjs` 会检查文件是否存在。
- **命令按最终结构写**：测试在 `tests/`，工具在 `tools/`；门禁命令以 `package.json` 的 scripts 为准，不要手抄旧路径。
- **设置类内容标注状态**：GitHub 网页设置无法由代码保证，涉及仓库设置时写「建议 / 需人工确认」，不要声称已经配置。
- **图片不要手工替换**：`docs/panel.png` 与两张 `.webp` 由 `npm run docs:images` 重新生成，见 [IMAGE_PIPELINE.md](IMAGE_PIPELINE.md)。
