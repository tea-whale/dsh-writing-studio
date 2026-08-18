/**
 * index.js —— dsh-writing-studio 插件入口。
 *
 * 一个零依赖的工具型插件：给模型注册一套 writing_* 工具，
 * 把长篇写作拆成「建项目 → 定风格 → 定大纲 → 逐节成稿 → 逐节审校 → 汇编成稿」。
 * 真正的文字由模型生成；工具只负责把状态可靠地存到磁盘，
 * 因此长文写作可以跨轮次、跨上下文压缩继续。
 *
 * 插件形状：export name / inject / apply —— 与官方 dsh-tool-* 同构。
 * 工具定义直接使用 registry 的原始 JSON Schema 子集，不 import harness 包。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addHistory,
  countWords,
  createProject,
  ensureStorage,
  findSection,
  listProjects,
  projectFilePath,
  readProject,
  updateProject,
} from "./store.js";
import {
  STYLE_ENUMS,
  TEMPLATES,
  applyStylePatch,
  styleFromTemplate,
  templateByKey,
} from "./templates.js";

export const name = "writing-studio";
export const inject = ["tools"];

/** 会话 → 最近一次使用的项目文件，status 等省略 project 参数时靠它兜底。 */
const lastProjectBySession = new Map();

/* ────────────────────────── 基础校验与渲染 ────────────────────────── */

function fail(message) {
  throw new Error(message);
}

function asString(args, key, { required = false, trim = true } = {}) {
  const value = args?.[key];
  if (value === undefined || value === null) {
    if (required) fail(`参数 ${key} 必填`);
    return undefined;
  }
  if (typeof value !== "string") fail(`参数 ${key} 必须是字符串`);
  if (required && trim && value.trim().length === 0) fail(`参数 ${key} 不能为空`);
  return value;
}

function asOptionalBool(args, key) {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") fail(`参数 ${key} 必须是布尔值`);
  return value;
}

function asEnum(args, key, allowed) {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`参数 ${key} 必须是 ${allowed.join(" / ")} 之一，收到 ${JSON.stringify(value)}`);
  }
  return value;
}

function asSectionRef(args) {
  const value = args?.section;
  if (value === undefined || value === null) fail("参数 section 必填");
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  fail("参数 section 必须是字符串（章节序号、id 或标题）或数字序号");
}

function sessionKey(exec) {
  return exec?.agent?.session?.id ?? "default";
}

function templateName(key) {
  const template = TEMPLATES.find((t) => t.key === key);
  return template ? `${template.name}（${key}）` : key;
}

function renderStyle(style) {
  const fields = [
    ["文体", style?.genre],
    ["语气", style?.tone],
    ["读者", style?.audience],
    ["语言", style?.language],
    ["视角", style?.pov],
    ["全篇目标", style?.targetWords ? `${style.targetWords} 字` : ""],
    ["每节目标", style?.sectionWords ? `${style.sectionWords} 字` : ""],
  ];
  const lines = fields
    .filter(([, value]) => typeof value === "string" && value.length > 0 || typeof value === "number")
    .map(([label, value]) => `- ${label}：${value}`);
  if (style?.extra) lines.push(`- 其他约束：${style.extra}`);
  return lines.join("\n");
}

function nextStep(project) {
  const firstEmpty = project.sections.findIndex((s) => (s.content ?? "").trim().length === 0);
  if (firstEmpty >= 0) {
    return `用 writing_section_save 撰写第 ${firstEmpty + 1} 节「${project.sections[firstEmpty].title}」`;
  }
  const firstNotDone = project.sections.findIndex((s) => s.status !== "done");
  if (firstNotDone >= 0) {
    return `第 ${firstNotDone + 1} 节已有草稿，用 writing_section_read 复核、writing_section_review 审校`;
  }
  return "全部章节已完成，用 writing_assemble 汇编成稿（也可以再次生成带时间戳的新版本）";
}

function renderStatus(project, file) {
  const total = project.sections.reduce((sum, s) => sum + countWords(s.content), 0);
  const done = project.sections.filter((s) => s.status === "done").length;
  const drafted = project.sections.filter((s) => (s.content ?? "").trim().length > 0).length;
  const lines = [
    `# 写作项目：${project.title}`,
    `- 项目名：${project.key}`,
    `- 模板：${templateName(project.template)}`,
    `- 文件：${file}`,
    `- 更新：${project.updatedAt ?? "未知"}`,
    `- 进度：${done}/${project.sections.length} 节完成，${drafted} 节有草稿，全文约 ${total} 字`,
  ];
  if (project.thesis) lines.push(`- 主旨：${project.thesis}`);
  lines.push("", "## 风格", renderStyle(project.style ?? {}), "", "## 章节");
  project.sections.forEach((section, index) => {
    const words = countWords(section.content);
    const statusText = {
      planned: "未动笔",
      drafting: "草稿中",
      drafted: "已起草",
      reviewed: "已审校",
      done: "已完成",
    }[section.status] ?? section.status;
    lines.push(`${index + 1}. [${statusText}] ${section.title}（${section.id}，约 ${words} 字）`);
  });
  lines.push("", `下一步：${nextStep(project)}`);
  return lines.join("\n");
}

function renderProgress(project) {
  const total = project.sections.reduce((sum, s) => sum + countWords(s.content), 0);
  const done = project.sections.filter((s) => s.status === "done").length;
  return `当前进度：${done}/${project.sections.length} 节完成，全文约 ${total} 字。下一步：${nextStep(project)}`;
}

/* ────────────────────────── 存储与项目定位 ────────────────────────── */

/** 打开显式指定或最近使用的项目。 */
async function openProject(exec, args, config) {
  const paths = await ensureStorage(exec, config, args.working_dir);
  let file;
  if (args.project !== undefined && args.project !== null && String(args.project).trim() !== "") {
    file = projectFilePath(paths.base, String(args.project));
  } else {
    const remembered = lastProjectBySession.get(sessionKey(exec));
    if (remembered) {
      try {
        await readProject(remembered);
        file = remembered;
      } catch {
        file = undefined;
      }
    }
    if (file === undefined) {
      const projects = await listProjects(paths.base);
      if (projects.length === 0) {
        fail("这个工作目录还没有写作项目，先用 writing_project_create 创建一个");
      }
      file = projects[0].file;
    }
  }
  const project = await readProject(file);
  lastProjectBySession.set(sessionKey(exec), file);
  return { project, file, paths };
}

/** 把汇编输出路径限制在存储根目录内。 */
function resolveOutputPath(paths, projectKey, output) {
  if (output === undefined || output === null || String(output).trim() === "") {
    return path.join(paths.manuscripts, `${projectKey}.md`);
  }
  let rel = String(output).trim().replace(/\\/g, "/");
  if (path.isAbsolute(rel)) fail("output 只能是相对存储根目录的路径，不能是绝对路径");
  if (!rel.toLowerCase().endsWith(".md")) rel += ".md";
  const resolved = path.resolve(paths.base, rel);
  if (resolved !== paths.base && !resolved.startsWith(paths.base + path.sep)) {
    fail(`output 越界：${output}`);
  }
  return resolved;
}

/* ────────────────────────── JSON Schema 小工厂 ────────────────────────── */

const S = (description) => ({ type: "string", description });
const OS = (description) => ({ type: "string", description });
const B = (description) => ({ type: "boolean", description });
const I = (description) => ({ type: "integer", description });
const E = (values, description) => ({ type: "string", enum: values, description });
const O = (properties, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const A = (items, description) => ({ type: "array", items, description });

const WORKING_DIR = S("可选：写作项目存储的根目录（绝对路径或相对当前会话工作目录的路径）。默认写入当前工作目录下的 .writing-studio/。");
const PROJECT_OPT = S("可选：项目名/slug 或相对路径；省略时使用本会话最近一次操作的写作项目。");
const STYLE_SCHEMA = O({
  genre: S("文体，如：公众号文章、技术博客、散文、小说"),
  tone: E(STYLE_ENUMS.tone, "语气"),
  audience: E(STYLE_ENUMS.audience, "目标读者"),
  language: E(STYLE_ENUMS.language, "写作语言"),
  pov: E(STYLE_ENUMS.pov, "叙述视角"),
  targetWords: I("全篇目标字数（50-100000）"),
  sectionWords: I("每节目标字数（50-100000）"),
  extra: S("其他风格约束，自由文本"),
}, []);

function defineTool({ name: toolName, description, properties, required, execute }) {
  return {
    name: toolName,
    description,
    parameters: { type: "object", properties, required },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args, exec) {
      return execute(args, exec);
    },
  };
}

/* ────────────────────────── 工具实现 ────────────────────────── */

const createProjectTool = defineTool({
  name: "writing_project_create",
  description:
    "创建一个写作项目（长文工作台）。指定标题和模板后，项目会带上该模板的默认大纲与风格参数，持久化到磁盘。创建后按流程推进：writing_outline_set 调大纲 → 逐节 writing_section_save 起草 → writing_section_review 审校 → writing_assemble 汇编成稿。",
  properties: {
    title: S("文章标题（必填）"),
    template: E(TEMPLATES.map((t) => t.key), `写作模板 key：${TEMPLATES.map((t) => `${t.key}=${t.name}`).join("，")}`),
    thesis: OS("可选：一句话主旨/中心论点"),
    style: STYLE_SCHEMA,
    author: OS("可选：作者署名"),
    working_dir: WORKING_DIR,
  },
  required: ["title", "template"],
  async execute(args, exec) {
    const title = asString(args, "title", { required: true }).trim();
    const templateKey = asString(args, "template", { required: true }).trim();
    const template = templateByKey(templateKey);
    const style = applyStylePatch(styleFromTemplate(template), args.style);
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    const { project, file } = await createProject(paths.base, {
      title,
      templateKey,
      template,
      style,
      thesis: asString(args, "thesis")?.trim() ?? "",
      author: asString(args, "author")?.trim() ?? "",
    });
    lastProjectBySession.set(sessionKey(exec), file);
    return [
      `已创建写作项目「${title}」（项目名 ${project.key}）。`,
      `- 模板：${template.name}`,
      `- 存储：${file}`,
      `- 大纲：${project.sections.length} 节`,
      "",
      "## 风格参数",
      renderStyle(style),
      "",
      `模板提示：${template.tips}`,
      "",
      "推荐流程：",
      "1. 用 writing_outline_set 按需调整大纲与主旨；",
      "2. 用 writing_style_set 微调风格与字数目标；",
      "3. 逐节起草：writing_section_save（写一节存一节）；",
      "4. 逐节审校：writing_section_review（可回写修订稿）；",
      "5. 全部完成后 writing_assemble 汇编为 markdown 成稿。",
      `下一步：${nextStep(project)}`,
    ].join("\n");
  },
});

const projectOpenTool = defineTool({
  name: "writing_project_open",
  description: "打开一个已存在的写作项目，返回其完整状态（风格、大纲、各章节进度与字数、下一步建议）。",
  properties: { project: PROJECT_OPT, working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const { project, file } = await openProject(exec, args, config);
    return renderStatus(project, file);
  },
});

const statusTool = defineTool({
  name: "writing_status",
  description:
    "查看当前写作项目的状态：风格参数、大纲、各章节进度与字数、下一步建议。不指定 project 时自动使用本会话最近一次操作的写作项目。上下文被压缩后，先调用本工具恢复工作现场。",
  properties: { project: PROJECT_OPT, working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const { project, file } = await openProject(exec, args, config);
    return renderStatus(project, file);
  },
});

const listTool = defineTool({
  name: "writing_projects_list",
  description: "列出工作目录下的所有写作项目（项目名、标题、模板、进度、字数、最近更新时间）。",
  properties: { working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    const rows = await listProjects(paths.base);
    if (rows.length === 0) return "还没有写作项目，用 writing_project_create 创建第一个。";
    const lines = rows.map(
      (row, index) =>
        `${index + 1}. ${row.title}（${row.key}）模板：${templateName(row.template)}；${row.drafted}/${row.sections} 节有草稿，${row.done} 节完成；约 ${row.totalWords} 字；更新于 ${row.updatedAt}`,
    );
    return ["写作项目列表（最近更新在前）：", ...lines].join("\n");
  },
});

const templatesTool = defineTool({
  name: "writing_templates",
  description:
    "列出全部写作模板（公众号文章、技术博客、周报、小说章节、小红书笔记、演讲稿、调研报告、使用教程等），包含每个模板的默认大纲、风格参数和写作提示。创建项目前先看它选模板。",
  properties: {},
  required: [],
  async execute() {
    const lines = TEMPLATES.map((template) => {
      const outline = template.outline.map((s, i) => `   ${i + 1}. ${s.title}：${s.goal}`).join("\n");
      return [
        `## ${template.name}（key: ${template.key}）`,
        `- 文体：${template.genre}`,
        `- 默认风格：${renderStyle(styleFromTemplate(template)).replaceAll("\n", "；")}`,
        `- 默认大纲：`,
        outline,
        `- 写作提示：${template.tips}`,
      ].join("\n");
    });
    return lines.join("\n\n");
  },
});

const styleTool = defineTool({
  name: "writing_style_set",
  description:
    "查看或修改当前项目的风格参数（文体、语气、目标读者、语言、视角、全篇/每节目标字数、额外约束）。所有字段可选，只更新传入的字段；不传 style 时返回当前风格。",
  properties: { project: PROJECT_OPT, working_dir: WORKING_DIR, style: STYLE_SCHEMA },
  required: [],
  async execute(args, exec) {
    const { project, file } = await openProject(exec, args, config);
    if (args.style === undefined || args.style === null) {
      return `当前风格：\n${renderStyle(project.style ?? {})}`;
    }
    await updateProject(file, (current) => {
      current.style = applyStylePatch(current.style ?? {}, args.style);
      addHistory(current, "style", "调整风格参数");
      return current;
    });
    const refreshed = await readProject(file);
    return [
      `已更新「${refreshed.title}」的风格参数：`,
      renderStyle(refreshed.style ?? {}),
      "",
      renderProgress(refreshed),
    ].join("\n");
  },
});

const outlineTool = defineTool({
  name: "writing_outline_set",
  description:
    "设置或替换当前项目的写作大纲：写入主旨（thesis）和章节列表（每节给标题与写作目标）。默认按位置保留已有章节的草稿与审校记录（preserve_drafts=false 则全部重置）。",
  properties: {
    project: PROJECT_OPT,
    working_dir: WORKING_DIR,
    thesis: OS("可选：一句话主旨/中心论点"),
    sections: A(
      O({
        title: S("本节标题"),
        goal: OS("本节要完成什么：内容范围、要回答的问题或情绪效果"),
      }, ["title"]),
      "章节列表（至少 1 节），按顺序排列",
    ),
    preserve_drafts: B("默认 true：按位置保留旧大纲中对应章节的草稿与审校记录"),
  },
  required: ["sections"],
  async execute(args, exec) {
    if (!Array.isArray(args.sections) || args.sections.length === 0) fail("参数 sections 至少包含 1 节");
    for (const [i, section] of args.sections.entries()) {
      if (section === null || typeof section !== "object" || Array.isArray(section)) fail(`第 ${i + 1} 节必须是对象`);
      if (typeof section.title !== "string" || section.title.trim() === "") fail(`第 ${i + 1} 节的 title 必填`);
      if (section.goal !== undefined && typeof section.goal !== "string") fail(`第 ${i + 1} 节的 goal 必须是字符串`);
    }
    const preserve = asOptionalBool(args, "preserve_drafts") ?? true;
    const { project, file } = await openProject(exec, args, config);
    await updateProject(file, (current) => {
      if (args.thesis !== undefined) {
        if (typeof args.thesis !== "string") fail("参数 thesis 必须是字符串");
        current.thesis = args.thesis;
      }
      const oldSections = current.sections ?? [];
      current.sections = args.sections.map((section, index) => {
        const previous = preserve ? oldSections[index] : undefined;
        const content = previous?.content ?? "";
        return {
          id: `s${index + 1}`,
          title: section.title.trim(),
          goal: section.goal ?? previous?.goal ?? "",
          status: content.trim().length > 0 ? (previous?.status ?? "drafted") : "planned",
          content,
          reviewNotes: previous?.reviewNotes ?? [],
          words: countWords(content),
        };
      });
      addHistory(current, "outline", `大纲更新为 ${current.sections.length} 节`);
      return current;
    });
    const refreshed = await readProject(file);
    return [
      `已更新「${refreshed.title}」的大纲（${refreshed.sections.length} 节）${preserve ? "，原有草稿按位置保留" : "，草稿已重置"}。`,
      "",
      renderStatus(refreshed, file),
    ].join("\n");
  },
});

const sectionSaveTool = defineTool({
  name: "writing_section_save",
  description:
    "保存一个章节的草稿（模型自己写好正文后调它落盘）。section 用序号（如 1）、id（如 s1）或标题定位。保存后返回字数与整体进度；每写完一节存一节，长文就不会丢。",
  properties: {
    project: PROJECT_OPT,
    working_dir: WORKING_DIR,
    section: S("章节定位：1 起始序号（如 \"1\"）、id（如 \"s1\"）或完整标题"),
    content: S("本节正文（markdown，完整正文，必填）"),
    title: OS("可选：同时修改本节标题"),
    status: E(["drafting", "drafted", "reviewed", "done"], "可选：本节状态，默认 drafted"),
  },
  required: ["section", "content"],
  async execute(args, exec) {
    const sectionRef = asSectionRef(args);
    const content = asString(args, "content", { required: true, trim: false });
    if (content.trim().length === 0) fail("参数 content 不能为空");
    const status = asEnum(args, "status", ["drafting", "drafted", "reviewed", "done"]) ?? "drafted";
    const { project, file } = await openProject(exec, args, config);
    const { index, section } = findSection(project, sectionRef);
    const title = asString(args, "title")?.trim();
    await updateProject(file, (current) => {
      const target = findSection(current, sectionRef).section;
      target.content = content;
      target.words = countWords(content);
      target.status = status;
      if (title) target.title = title;
      addHistory(current, "section-save", `保存第 ${index + 1} 节「${target.title}」（${target.words} 字）`);
      return current;
    });
    return [
      `已保存第 ${index + 1} 节「${title ?? section.title}」：约 ${countWords(content)} 字，状态 ${status}。`,
      renderProgress((await readProject(file))),
    ].join("\n");
  },
});

const sectionReadTool = defineTool({
  name: "writing_section_read",
  description:
    "读取一个章节的当前草稿、写作目标与状态。上下文压缩或需要续写某节时，先调它把该节现场取回来。",
  properties: {
    project: PROJECT_OPT,
    working_dir: WORKING_DIR,
    section: S("章节定位：1 起始序号（如 \"1\"）、id（如 \"s1\"）或完整标题"),
  },
  required: ["section"],
  async execute(args, exec) {
    const sectionRef = asSectionRef(args);
    const { project, file } = await openProject(exec, args, config);
    const { index, section } = findSection(project, sectionRef);
    if ((section.content ?? "").trim().length === 0) {
      return [
        `第 ${index + 1} 节「${section.title}」还没有草稿。`,
        `- 写作目标：${section.goal || "（未设定）"}`,
        `- 建议字数：约 ${project.style?.sectionWords ?? 500} 字`,
        "",
        `写好正文后调 writing_section_save 保存（section 用 ${section.id} 或 ${index + 1}）。`,
      ].join("\n");
    }
    return [
      `# 第 ${index + 1} 节「${section.title}」（${section.id}）`,
      `- 状态：${section.status}；约 ${countWords(section.content)} 字`,
      `- 写作目标：${section.goal || "（未设定）"}`,
      ...(section.reviewNotes?.length
        ? [`- 最近审校：${section.reviewNotes[section.reviewNotes.length - 1].comments ?? ""}`]
        : []),
      "",
      "## 正文",
      section.content,
    ].join("\n");
  },
});

const sectionReviewTool = defineTool({
  name: "writing_section_review",
  description:
    "审校一个章节：记录审校意见（comments）与问题清单（issues）。若给出修订稿 revised_content，则用修订稿替换正文并把状态置为 reviewed；decision=pass 表示定稿。审校后调 writing_section_save 或直接进入下一节。",
  properties: {
    project: PROJECT_OPT,
    working_dir: WORKING_DIR,
    section: S("章节定位：1 起始序号（如 \"1\"）、id（如 \"s1\"）或完整标题"),
    comments: S("审校意见/修改说明（必填）"),
    issues: A(S("问题描述"), "可选：问题清单"),
    revised_content: S("可选：修订后的完整正文；提供则替换原草稿"),
    decision: E(["pass", "revise"], "可选：pass=通过定稿；revise=需要继续修改"),
  },
  required: ["section", "comments"],
  async execute(args, exec) {
    const sectionRef = asSectionRef(args);
    const comments = asString(args, "comments", { required: true });
    if (comments.trim().length === 0) fail("参数 comments 不能为空");
    const decision = asEnum(args, "decision", ["pass", "revise"]);
    const revised = asString(args, "revised_content", { trim: false });
    if (revised !== undefined && revised.trim().length === 0) fail("参数 revised_content 不能为空");
    const issues = args.issues === undefined || args.issues === null ? [] : args.issues;
    if (!Array.isArray(issues) || issues.some((issue) => typeof issue !== "string")) {
      fail("参数 issues 必须是字符串数组");
    }
    const { project, file } = await openProject(exec, args, config);
    const { index, section } = findSection(project, sectionRef);
    await updateProject(file, (current) => {
      const target = findSection(current, sectionRef).section;
      const note = {
        at: new Date().toISOString(),
        comments,
        issues,
        decision: decision ?? (revised !== undefined ? "revise" : "notes"),
      };
      target.reviewNotes = [...(target.reviewNotes ?? []), note];
      if (revised !== undefined) {
        target.content = revised;
        target.words = countWords(revised);
        target.status = "reviewed";
      } else if (decision === "pass") {
        target.status = "reviewed";
      } else {
        target.status = (target.content ?? "").trim().length > 0 ? "drafting" : "planned";
      }
      addHistory(current, "section-review", `审校第 ${index + 1} 节「${target.title}」`);
      return current;
    });
    const refreshed = await readProject(file);
    const target = findSection(refreshed, sectionRef).section;
    return [
      `已完成第 ${index + 1} 节「${target.title}」的审校：状态 ${target.status}，约 ${countWords(target.content)} 字。`,
      `- 意见：${comments}`,
      ...(issues.length ? issues.map((issue, i) => `- 问题 ${i + 1}：${issue}`) : []),
      ...(revised !== undefined ? ["- 修订稿已替换原草稿"] : []),
      ...(decision === "pass" ? ["- 本节已定稿"] : []),
      "",
      renderProgress(refreshed),
    ].join("\n");
  },
});

const assembleTool = defineTool({
  name: "writing_assemble",
  description:
    "把当前项目的所有章节草稿汇编成一篇完整 markdown 成稿（含标题与风格信息 front matter），保存到 manuscripts/ 目录并返回路径与字数统计。默认收录所有有内容的章节；only_reviewed=true 只收已审校/已完成章节。",
  properties: {
    project: PROJECT_OPT,
    working_dir: WORKING_DIR,
    output: OS("可选：输出相对路径（相对存储根目录），默认 manuscripts/<项目名>.md"),
    only_reviewed: B("默认 false；true 时只收录状态为 reviewed/done 的章节"),
    include_review_notes: B("默认 false；true 时在每节后以引用块附上审校意见"),
  },
  required: [],
  async execute(args, exec) {
    const onlyReviewed = asOptionalBool(args, "only_reviewed") ?? false;
    const includeNotes = asOptionalBool(args, "include_review_notes") ?? false;
    const { project, file, paths } = await openProject(exec, args, config);
    const outputFile = resolveOutputPath(paths, project.key, asString(args, "output"));
    const included = [];
    const skipped = [];
    for (const section of project.sections) {
      if ((section.content ?? "").trim().length === 0) {
        skipped.push(`${section.title}：还没有草稿`);
        continue;
      }
      if (onlyReviewed && !["reviewed", "done"].includes(section.status)) {
        skipped.push(`${section.title}：状态 ${section.status}（未审校）`);
        continue;
      }
      included.push(section);
    }
    if (included.length === 0) {
      fail(skipped.length > 0 ? `没有可汇编的章节：${skipped.join("；")}` : "项目大纲为空，先写章节草稿再汇编");
    }
    const style = project.style ?? {};
    const yamlString = (value) => JSON.stringify(String(value ?? ""));
    const frontMatter = [
      "---",
      `title: ${yamlString(project.title)}`,
      `template: ${yamlString(project.template)}`,
      `genre: ${yamlString(style.genre)}`,
      `tone: ${yamlString(style.tone)}`,
      `audience: ${yamlString(style.audience)}`,
      `language: ${yamlString(style.language)}`,
      `pov: ${yamlString(style.pov)}`,
      ...(project.author ? [`author: ${yamlString(project.author)}`] : []),
      `created: ${yamlString(project.createdAt)}`,
      "---",
    ].join("\n");
    const body = [`# ${project.title}`, ""];
    if (project.thesis) body.push(`> ${project.thesis}`, "");
    let totalWords = 0;
    for (const section of included) {
      body.push(`## ${section.title}`, "", section.content.trim());
      totalWords += countWords(section.content);
      if (includeNotes && section.reviewNotes?.length) {
        body.push("", `> 审校意见：${section.reviewNotes.map((n) => n.comments).join("；")}`);
      }
      body.push("");
    }
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${frontMatter}\n\n${body.join("\n")}\n`, "utf8");
    await updateProject(file, (current) => {
      for (const section of included) {
        const target = findSection(current, section.id).section;
        target.status = "done";
      }
      addHistory(current, "assemble", `汇编 ${included.length} 节 → ${outputFile}`);
      return current;
    });
    return [
      `成稿已汇编：${outputFile}`,
      `- 收录：${included.length}/${project.sections.length} 节，约 ${totalWords} 字（目标约 ${style.targetWords ?? 2000} 字）`,
      ...(skipped.length ? [`- 跳过：${skipped.join("；")}`] : []),
      "",
      "成稿为 markdown，可直接预览/发布；需要不同版本时用 output 指定新文件名再次汇编。",
    ].join("\n");
  },
});

/* ────────────────────────── 插件装配 ────────────────────────── */

let config = {};

export function apply(ctx, pluginConfig = {}) {
  config = { ...pluginConfig };
  const tools = [
    createProjectTool,
    projectOpenTool,
    statusTool,
    listTool,
    templatesTool,
    styleTool,
    outlineTool,
    sectionSaveTool,
    sectionReadTool,
    sectionReviewTool,
    assembleTool,
  ];
  for (const tool of tools) ctx.tools.register(tool);

  // 有 systemPrompt 服务时挂一段轻量引导；没有也不影响工具本身。
  const systemPrompt = ctx.get?.("systemPrompt");
  if (systemPrompt && typeof systemPrompt.section === "function") {
    systemPrompt.section({
      name: "tool:writing-studio",
      order: 106,
      text: "For long-form writing tasks (articles, blog posts, reports, stories, tutorials, speeches, social posts), prefer the writing_* tool family: create a project, set outline and style, draft and review sections one by one with writing_section_save / writing_section_review, then assemble the final manuscript with writing_assemble. Use writing_status to restore the project state after context compaction.",
    });
  }
}
