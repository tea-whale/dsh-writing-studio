import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  countWords,
  createProject,
  findSection,
  projectFilePath,
  readProject,
  slugify,
  updateProject,
} from "../store.js";
import { TEMPLATES, applyStylePatch, templateByKey } from "../templates.js";

async function tempBase() {
  return mkdtemp(path.join(tmpdir(), "dsh-writing-"));
}

test("countWords 统计中英文混合字数", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("你好，世界"), 4);
  assert.equal(countWords("hello world, it's fine"), 4);
  assert.equal(countWords("DeepSeek Harness 很好用"), 2 + 3);
});

test("slugify 生成安全文件名并保留中文", () => {
  assert.equal(slugify("  公众号文章：如何写作  "), "公众号文章：如何写作");
  assert.ok(slugify("a/b:c*d?e").includes("-"));
  assert.match(slugify(""), /^project-/);
});

test("projectFilePath 拒绝绝对路径与越界路径", () => {
  const base = path.join(process.cwd(), ".writing-studio");
  assert.ok(projectFilePath(base, "我的文章").endsWith("我的文章.json"));
  assert.ok(projectFilePath(base, "projects/demo").endsWith("demo.json"));
  assert.throws(() => projectFilePath(base, ".."), /越界/);
  assert.throws(() => projectFilePath(base, "../evil"), /越界/);
  assert.throws(() => projectFilePath(base, "/etc/passwd"), /绝对路径/);
});

test("创建项目并完成一轮写-改-读", async () => {
  const base = await tempBase();
  try {
    const template = templateByKey("wechat");
    const { project, file } = await createProject(base, {
      title: "测试文章",
      templateKey: "wechat",
      template,
      style: applyStylePatch({ tone: "轻松幽默" }, {}),
    });
    assert.equal(project.sections.length, template.outline.length);
    assert.equal(project.sections[0].status, "planned");

    await updateProject(file, (current) => {
      const section = findSection(current, "1").section;
      section.content = "这是第一节草稿。";
      section.status = "drafted";
      return current;
    });
    const reloaded = await readProject(file);
    assert.equal(findSection(reloaded, "s1").section.content, "这是第一节草稿。");
    assert.equal(findSection(reloaded, "开头钩子").section.status, "drafted");
    assert.throws(() => findSection(reloaded, "99"), /找不到章节/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("同名项目自动生成唯一文件名", async () => {
  const base = await tempBase();
  try {
    const template = templateByKey("weekly");
    const first = await createProject(base, {
      title: "周报",
      templateKey: "weekly",
      template,
      style: {},
    });
    const second = await createProject(base, {
      title: "周报",
      templateKey: "weekly",
      template,
      style: {},
    });
    assert.notEqual(first.file, second.file);
    assert.equal(await readFile(first.file, "utf8").then((s) => JSON.parse(s).key), "周报");
    assert.match(second.project.key, /^周报-2$/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("模板与风格校验", () => {
  assert.throws(() => templateByKey("nope"), /可用模板/);
  const style = applyStylePatch({}, { tone: "轻松幽默", targetWords: 3000 });
  assert.equal(style.tone, "轻松幽默");
  assert.equal(style.targetWords, 3000);
  assert.throws(() => applyStylePatch({}, { tone: "不存在的语气" }), /必须是/);
  assert.throws(() => applyStylePatch({}, { unknown: "x" }), /未知风格字段/);
  assert.throws(() => applyStylePatch({}, { targetWords: 10 }), /50-100000/);
  assert.ok(TEMPLATES.length >= 8);
});
