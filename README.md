# dsh-writing-studio

> DeepSeek Harness (DSH) 写作工具插件：把长篇写作变成一条可续写、可审校、可汇编的流水线。

[![CI](https://github.com/tea-whale/dsh-writing-studio/actions/workflows/test.yml/badge.svg)](https://github.com/tea-whale/dsh-writing-studio/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/works%20with-DeepSeek%20Harness-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)

一个零运行时依赖的 DSH 工具型插件：注册 `writing_*` 工具族，提供**长文工作流、风格控制、常用写作模板**。文字由模型生成，插件负责把项目状态可靠地落盘——上下文压缩、会话中断、换台电脑都能接着写。

## 能力

| 能力 | 说明 |
| --- | --- |
| 长文工作流 | 建项目 → 定大纲 → 逐节起草 → 逐节审校 → 汇编成稿 |
| 风格控制 | 文体 / 语气 / 读者 / 语言 / 视角 / 全篇与每节目标字数 / 自定义约束 |
| 常用模板 | 公众号文章、技术博客、周报、小说章节、小红书笔记、演讲稿、调研报告、使用教程 |
| 持久化 | 每个项目一个 JSON（大纲、草稿、审校记录、历史），成稿输出 markdown |

## 安装

### 从本仓库安装（当前方式）

```sh
git clone https://github.com/tea-whale/dsh-writing-studio.git
cd dsh-writing-studio
dsh plugin --profile web add link:$(pwd)
```

PowerShell（Windows）：

```powershell
dsh plugin --profile web add link:D:\path\to\dsh-writing-studio
```

装完**重启 `dsh web`**。验证：

```sh
dsh --profile web --dump-config
# 应能看到 id: writing-studio 的行
```

卸载：

```sh
dsh plugin --profile web remove dsh-writing-studio
```

> 计划发布 npm 后，安装将简化为：
> `dsh plugin --profile web add <包名>`

## 用法

重启后在 dsh web 里新开会话，直接说：

> 用写作工具帮我写一篇「DeepSeek Harness 插件入门」技术博客，目标 3000 字，读者是会写代码的开发者。

模型会自动走：`writing_templates` 选模板 → `writing_project_create` 建项目 → 逐节 `writing_section_save` 起草 → `writing_section_review` 审校 → `writing_assemble` 汇编成稿。

也可以在关键节点直接下指令：

> writing_status 看一下进度
> 第 2 节重写，语气再轻松一点，先 writing_section_read 再 writing_section_save
> 全文审校一遍，每节用 writing_section_review，最后 writing_assemble

### 工具一览

| 工具 | 作用 |
| --- | --- |
| `writing_templates` | 列出 8 套模板及其默认大纲、风格、写作提示 |
| `writing_project_create` | 用标题 + 模板创建项目 |
| `writing_project_open` | 打开已有项目，恢复完整状态 |
| `writing_projects_list` | 列出工作目录下全部项目与进度 |
| `writing_status` | 查看当前项目状态与下一步建议 |
| `writing_style_set` | 查看 / 修改风格参数与字数目标 |
| `writing_outline_set` | 替换大纲与主旨；默认按位置保留已有草稿 |
| `writing_section_save` | 保存一节草稿（写一节存一节） |
| `writing_section_read` | 取回一节草稿与写作目标（续写用） |
| `writing_section_review` | 记录审校意见 / 问题清单 / 修订稿 / 定稿 |
| `writing_assemble` | 汇编成带 front matter 的完整 markdown 成稿 |

## 存储布局

默认在每个会话工作目录下：

```text
<工作目录>/
└── .writing-studio/
    ├── projects/
    │   └── <项目名>.json        # 风格、大纲、各节草稿、审校记录、历史
    └── manuscripts/
        └── <项目名>.md          # 汇编后的成稿
```

项目文件是普通 JSON，可提交进 git、拷走或手动编辑。默认用会话的 `header.cwd`；工具参数 `working_dir` 可指定其它目录，插件行 `config.rootDir` 可改默认目录名。

## 自定义模板与风格

所有写作规则都集中在 `templates.js`：

- `STYLE_ENUMS`：语气 / 读者 / 语言 / 视角的可选项；
- `TEMPLATES`：每套模板的 `key`、`name`、默认风格、章节大纲（`title` + `goal`）与写作提示。

复制一个模板整块并修改 `key / name / outline / defaultStyle / tips` 即可新增模板，无需改其它代码。临时要求也可以直接在对话里让模型用 `writing_style_set` 写进项目的 `extra` 约束。

## 开发

```text
dsh-writing-studio
├── index.js                 # 插件入口：name / inject / apply + 11 个工具
├── store.js                 # 项目读写、字数统计、路径安全、原子写入
├── templates.js             # 8 套模板 + 风格枚举/校验
├── cordis.patch.yml         # bundle 补丁：把插件行 insert 进 profile
├── package.json             # dsh.bundle.patch 声明与测试依赖
└── test/
    ├── store.test.mjs       # 存储层单元测试
    └── schema-check.mjs     # 官方 schema 校验 + 端到端工作流模拟
```

插件运行时零依赖（只 import Node 内置模块），工具定义直接采用 DSH registry 的 JSON Schema 子集，避免本地 `link:` 挂载时 ESM 符号链接解析问题。测试依赖 `@deepseek-ai/dsh-tools` 用 harness 官方校验器验证全部工具定义。

```sh
npm install
npm test
```

## 已知限制

- 工具不调用模型：写作、修改、审校都由当前会话的模型完成，工具只做状态机与持久化，不消耗额外 API。
- 风格字段是「提示合同」而非自动风格检测；最终质量取决于模型。
- `writing_assemble` 默认覆盖 `manuscripts/<项目名>.md`，需要多版本时用 `output` 指定文件名。
- 插件全局注册；在 agent 预设显式裁剪全局工具的会话里，`writing_*` 同样会被裁掉。

## 生态

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— DSH 本体
- [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) —— DSH Web GUI 插件与皮肤全家桶
- [dshfind](https://dshfind.com) —— DSH 学习与分享社区

## License

[MIT](LICENSE) © 2026 [tea-whale](https://github.com/tea-whale)
