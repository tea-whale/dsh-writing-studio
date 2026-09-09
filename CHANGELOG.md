# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.1] - 2026-09-09

一次针对"可靠落盘"的修缺陷版本：把并发、路径与状态语义上的静默数据问题全部修掉，并补上对应的回归测试（测试数 9 → 23）。

### Fixed

- **并发创建同名项目会互相覆盖**：重名检测原先在锁外，4 个并发创建会得到同一个文件名，只剩 1 个项目。改为目录级锁 + `open(..., 'wx')` 独占创建，冲突时自动加 `-2/-3` 后缀（跨进程同样安全）。
- **`writeJsonAtomic` 先 `rm` 再 `rename`**：两步之间崩溃/断电会让项目文件直接消失。改为临时文件 `fsync` + `rename` 原子替换（Windows 上偶发 EPERM/EBUSY 时重试一次），并在临时文件名里加入自增序号，避免同一毫秒的并发写入撞名。
- **成稿可能写到存储根目录之外**：`writing_assemble` 的默认输出路径直接拼接项目 `key`，而项目 JSON 是"可手改、可提交 git"的，改过的 `key`（如 `../../x`）能越出 `.writing-studio/`。默认路径现在也重新 `slugify` 并做包含性校验。
- **章节状态会被无关操作打回**：保存草稿、只记审校意见、汇编成稿都会把 `reviewed`/`done` 降级，导致 `writing_assemble({only_reviewed:true})` 少收录章节。新增 `promoteStatus` 单向推进：只有 `decision=revise` 才显式回退；汇编只把已审校的章节定稿。
- **模板默认值不在枚举里**：`wechat` 模板的 `tone` 是 `"亲切有力"`，而 `STYLE_ENUMS.tone` 没有该值——项目创建后带着一个 `writing_style_set` 自己会拒绝的值。改为 `"亲切温暖"`，并新增测试保证每个模板的默认风格都合法。
- **`countWords` 漏算假名、谚文与扩展区汉字**：改用 Unicode 属性转义（`\p{Script=Han|Hiragana|Katakana|Hangul}`），`コーヒー`、`한글`、`𠀋𠮷` 不再统计为 0。
- **`slugify` 截断会劈开代理对**：按码点截断，并给 Windows 设备名（`CON`/`NUL`/`COM1`…）加下划线前缀。
- **坏项目文件抛 `TypeError`**：`readProject` 现在校验 `schemaVersion`（比本插件新则明确报错），并规范化章节形状，缺字段补默认值、坏章节给出可读错误。
- **省略 `project` 时猜错项目**：同一目录存在多个项目时不再自动选"最近修改的那个"，而是报错要求显式指定（单项目目录仍自动选中）。

### Changed

- `engines.node` 从 `>=18.0.0` 提到 `>=20.0.0`（Node 18 已 EOL；测试脚本用 `--test-isolation=none`，需要 Node ≥ 22.8）。
- CI 增加 Node 22 / 24 矩阵；缺少 `@deepseek-ai/dsh-tools` 时在 CI 中硬失败，不再"零校验还绿"。
- `package-lock.json` 的 `resolved` 全部改回官方 registry（原为 `registry.npmmirror.com`，已逐个核对 integrity 一致）；`.npmrc` 显式声明官方源。
- 新增 `.github/dependabot.yml`，跟踪 `@deepseek-ai/*` 的 rc 版本线。

## [0.1.0] - 2026-08-18

首个版本：11 个 `writing_*` 工具、8 套写作模板、风格参数控制、项目状态落盘与汇编成稿。
