/**
 * store.js —— 写作项目的磁盘存储层。
 *
 * 纯 Node 内置模块实现，不依赖 harness 包，方便独立单元测试。
 * 存储布局（默认 <会话工作目录>/.writing-studio/）：
 *   projects/    每个写作项目一个 JSON 文件
 *   manuscripts/ 汇编后的成稿 markdown
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = 1;

/** 每项目文件一把进程内互斥锁，避免并发工具调用互相覆盖。 */
const locks = new Map();

export async function withLock(key, fn) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  locks.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

/** 统计字数：CJK 字符按字计，拉丁/数字串按词计，二者相加。 */
export function countWords(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uF900-\uFAFF]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

/** 把标题变成安全的文件主名；中文标题原样保留，去掉非法字符。 */
export function slugify(title) {
  const cleaned = String(title ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  if (cleaned.length > 0) return cleaned;
  return `project-${Date.now().toString(36)}`;
}

/** 当前会话工作目录（工具执行上下文中由 exec 提供）。 */
export function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}

/**
 * 解析存储根目录。
 * 优先级：本次调用显式 working_dir > 插件配置 storageRoot > 会话 cwd 下的 rootDir。
 */
export function storagePaths(exec, config, workingDir) {
  const cwd = sessionCwd(exec);
  let base;
  if (workingDir !== undefined && workingDir !== "") {
    base = path.isAbsolute(workingDir) ? workingDir : path.resolve(cwd, workingDir);
  } else if (config?.storageRoot) {
    base = path.resolve(config.storageRoot);
  } else {
    base = path.resolve(cwd, config?.rootDir ?? ".writing-studio");
  }
  return {
    base,
    projects: path.join(base, "projects"),
    manuscripts: path.join(base, "manuscripts"),
  };
}

/** 确保目录存在。 */
export async function ensureStorage(exec, config, workingDir) {
  const paths = storagePaths(exec, config, workingDir);
  await mkdir(paths.projects, { recursive: true });
  await mkdir(paths.manuscripts, { recursive: true });
  return paths;
}

/**
 * 把模型给的项目引用解析成项目 JSON 文件路径。
 * 接受：项目名/slug（自动补 .json）、相对路径（可带 projects/ 前缀）。
 * 拒绝绝对路径与越界路径。
 */
export function projectFilePath(base, ref) {
  let rel = String(ref ?? "").trim().replace(/\\/g, "/");
  if (rel.length === 0) throw new Error("project 不能为空");
  if (path.isAbsolute(rel)) throw new Error("project 只能是项目名或相对路径，不能是绝对路径");
  if (rel === ".." || rel.startsWith("../") || rel.includes("/../") || rel.endsWith("/..")) {
    throw new Error(`project 越界：${rel}`);
  }
  if (rel.startsWith("projects/")) rel = rel.slice("projects/".length);
  if (rel.startsWith("./")) rel = rel.slice(2);
  if (!rel.toLowerCase().endsWith(".json")) rel += ".json";
  const projects = path.join(base, "projects");
  const resolved = path.resolve(projects, rel);
  const prefix = projects + path.sep;
  if (resolved !== projects && !resolved.startsWith(prefix)) {
    throw new Error(`project 越界：${rel}`);
  }
  return resolved;
}

/** 原子写入 JSON（同目录临时文件 + rename）。 */
export async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await rm(file, { force: true });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/** 创建新项目并落盘，返回项目和文件路径。 */
export async function createProject(base, { title, templateKey, template, style, thesis = "", author = "" }) {
  const key = slugify(title);
  const projects = path.join(base, "projects");
  await mkdir(projects, { recursive: true });
  let file = path.join(projects, `${key}.json`);
  let unique = key;
  let n = 2;
  while (true) {
    try {
      await readFile(file, "utf8");
      unique = `${key}-${n}`;
      file = path.join(projects, `${unique}.json`);
      n += 1;
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  const now = new Date().toISOString();
  const sections = (template?.outline ?? []).map((section, index) => ({
    id: `s${index + 1}`,
    title: section.title,
    goal: section.goal ?? "",
    status: "planned",
    content: "",
    reviewNotes: [],
    words: 0,
  }));
  const project = {
    schemaVersion: SCHEMA_VERSION,
    key: unique,
    title,
    author,
    createdAt: now,
    updatedAt: now,
    template: templateKey,
    style,
    thesis,
    sections,
    history: [{ at: now, tool: "create", detail: `创建项目 ${title}` }],
  };
  return withLock(file, async () => {
    await writeJsonAtomic(file, project);
    return { project, file };
  });
}

/** 读取项目；文件缺失或 JSON 损坏给出可读错误。 */
export async function readProject(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`项目文件不存在：${file}`);
    throw error;
  }
  let project;
  try {
    project = JSON.parse(text);
  } catch {
    throw new Error(`项目文件损坏（不是合法 JSON）：${file}`);
  }
  if (project === null || typeof project !== "object" || Array.isArray(project)) {
    throw new Error(`项目文件内容无效：${file}`);
  }
  if (!Array.isArray(project.sections)) project.sections = [];
  if (project.style === null || typeof project.style !== "object") project.style = {};
  project.key = typeof project.key === "string" ? project.key : path.basename(file, ".json");
  project.title = typeof project.title === "string" ? project.title : project.key;
  return project;
}

/** 在项目锁内：读-改-写。mutator 抛错则不落盘。 */
export async function updateProject(file, mutator) {
  return withLock(file, async () => {
    const project = await readProject(file);
    const result = await mutator(project);
    project.updatedAt = new Date().toISOString();
    await writeJsonAtomic(file, project);
    return result;
  });
}

/** 追加历史记录，最多保留最近 50 条。 */
export function addHistory(project, tool, detail) {
  if (!Array.isArray(project.history)) project.history = [];
  project.history.push({ at: new Date().toISOString(), tool, detail });
  if (project.history.length > 50) project.history = project.history.slice(-50);
}

/** 列出所有项目，按最近修改时间倒序。 */
export async function listProjects(base) {
  const projectsDir = path.join(base, "projects");
  let entries = [];
  try {
    entries = await readdir(projectsDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".json")) continue;
    const file = path.join(projectsDir, entry);
    try {
      const project = await readProject(file);
      rows.push({
        key: project.key,
        title: project.title,
        template: project.template,
        updatedAt: project.updatedAt,
        file,
        sections: project.sections.length,
        done: project.sections.filter((s) => s.status === "done").length,
        drafted: project.sections.filter((s) => (s.content ?? "").trim().length > 0).length,
        totalWords: project.sections.reduce((sum, s) => sum + countWords(s.content), 0),
      });
    } catch {
      // 坏文件跳过，列表不因单个项目损坏而整体失败。
    }
  }
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** 按 id / 1 起始序号 / 标题定位章节。 */
export function findSection(project, ref) {
  const target = String(ref ?? "").trim();
  if (target.length === 0) throw new Error("section 不能为空");
  let index = -1;
  if (/^s\d+$/i.test(target)) {
    index = project.sections.findIndex((s) => String(s.id).toLowerCase() === target.toLowerCase());
  } else if (/^\d+$/.test(target)) {
    index = Number(target) - 1;
  } else {
    index = project.sections.findIndex((s) => s.title === target);
  }
  if (index < 0 || index >= project.sections.length || !project.sections[index]) {
    const hint = project.sections
      .map((s, i) => `${i + 1}. ${s.title}（${s.id}）`)
      .join("；");
    throw new Error(`找不到章节 "${target}"；当前章节：${hint || "（大纲为空）"}`);
  }
  return { index, section: project.sections[index] };
}
