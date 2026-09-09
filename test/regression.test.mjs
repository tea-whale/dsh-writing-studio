/**
 * regression.test.mjs —— 针对已修缺陷的回归测试。
 *
 * 每一条都对应一个真实复现过的问题：并发创建覆盖、成稿写到存储根目录外、
 * 状态被无关操作打回、字数统计漏假名/谚文、文件名劈开代理对、坏项目文件
 * 抛 TypeError 等。改坏任何一条都应该让 CI 红。
 *
 * 运行：node --test --test-isolation=none test/regression.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SCHEMA_VERSION,
  countWords,
  createProject,
  promoteStatus,
  readProject,
  slugify,
  writeJsonAtomic,
} from "../store.js";
import { STYLE_ENUMS, TEMPLATES, styleFromTemplate } from "../templates.js";
import { apply } from "../index.js";

async function tempBase() {
  return mkdtemp(path.join(tmpdir(), "dsh-writing-reg-"));
}

function loadTools() {
  const tools = [];
  apply({ tools: { register: (tool) => tools.push(tool) }, get: () => undefined }, {});
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function fakeExec(cwd, id = "session-test") {
  return {
    agent: { session: { id, header: { cwd } } },
    signal: new AbortController().signal,
    callId: "call-1",
    rootCallId: "root-1",
    parent: undefined,
  };
}

async function readProjectFile(cwd, key) {
  return JSON.parse(await readFile(path.join(cwd, ".writing-studio", "projects", `${key}.json`), "utf8"));
}

/* ────────────────────────── 模板默认值 ────────────────────────── */

test("每个模板的默认风格都是合法枚举值", () => {
  for (const template of TEMPLATES) {
    const style = styleFromTemplate(template);
    for (const [field, allowed] of Object.entries(STYLE_ENUMS)) {
      assert.ok(
        allowed.includes(style[field]),
        `${template.key}.${field} = "${style[field]}" 不在 ${allowed.join(" / ")} 里`,
      );
    }
    for (const field of ["targetWords", "sectionWords"]) {
      assert.ok(
        Number.isInteger(style[field]) && style[field] >= 50 && style[field] <= 100000,
        `${template.key}.${field} = ${style[field]} 超出 50-100000`,
      );
    }
  }
});

/* ────────────────────────── 原子写入 ────────────────────────── */

test("writeJsonAtomic 覆盖旧内容且不留临时文件", async () => {
  const dir = await tempBase();
  try {
    const file = path.join(dir, "a.json");
    await writeJsonAtomic(file, { n: 1 });
    await writeJsonAtomic(file, { n: 2 });
    assert.equal(JSON.parse(await readFile(file, "utf8")).n, 2);
    assert.deepEqual((await readdir(dir)).filter((name) => name.includes(".tmp-")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeJsonAtomic 并发写入同一文件后内容完整可解析", async () => {
  const dir = await tempBase();
  try {
    const file = path.join(dir, "b.json");
    await Promise.all(Array.from({ length: 8 }, (_, i) => writeJsonAtomic(file, { n: i, pad: "x".repeat(2000) })));
    const parsed = JSON.parse(await readFile(file, "utf8"));
    assert.equal(typeof parsed.n, "number");
    assert.deepEqual((await readdir(dir)).filter((name) => name.includes(".tmp-")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ────────────────────────── 并发创建 ────────────────────────── */

test("并发创建同名项目不会互相覆盖", async () => {
  const base = await tempBase();
  try {
    const template = TEMPLATES.find((entry) => entry.key === "weekly");
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createProject(base, { title: "并发标题", templateKey: "weekly", template, style: {} }),
      ),
    );
    const files = results.map((result) => path.basename(result.file));
    assert.equal(new Set(files).size, 4, `返回了重复文件名：${files.join(", ")}`);
    assert.equal(new Set(results.map((result) => result.project.key)).size, 4);
    assert.equal((await readdir(path.join(base, "projects"))).length, 4);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

/* ────────────────────────── 路径安全 ────────────────────────── */

test("手改项目 key 不能把成稿写到存储根目录之外", async () => {
  const cwd = await tempBase();
  try {
    const projects = path.join(cwd, ".writing-studio", "projects");
    await mkdir(projects, { recursive: true });
    await writeFile(
      path.join(projects, "evil.json"),
      JSON.stringify({
        schemaVersion: 1,
        key: "../../PWNED",
        title: "越界测试",
        template: "weekly",
        style: {},
        sections: [{ id: "s1", title: "a", goal: "", status: "done", content: "正文", reviewNotes: [], words: 2 }],
        history: [],
      }),
    );
    const tools = loadTools();
    const out = await tools.writing_assemble.execute({ project: "evil" }, fakeExec(cwd));
    const written = out.split("\n")[0].replace("成稿已汇编：", "");
    const manuscripts = path.join(cwd, ".writing-studio", "manuscripts");
    assert.ok(
      written.startsWith(manuscripts + path.sep),
      `成稿写到了 manuscripts 之外：${written}`,
    );
    await assert.rejects(readFile(path.join(cwd, "PWNED.md"), "utf8"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

/* ────────────────────────── 状态机 ────────────────────────── */

test("promoteStatus 只进不退", () => {
  assert.equal(promoteStatus("planned", "drafted"), "drafted");
  assert.equal(promoteStatus("reviewed", "drafted"), "reviewed");
  assert.equal(promoteStatus("done", "drafted"), "done");
  assert.equal(promoteStatus("planned", "reviewed"), "reviewed");
});

test("保存草稿不会把已审校的章节打回 drafted", async () => {
  const cwd = await tempBase();
  try {
    const tools = loadTools();
    const exec = fakeExec(cwd);
    await tools.writing_project_create.execute({ title: "状态测试", template: "weekly" }, exec);
    await tools.writing_section_save.execute({ section: "1", content: "第一版。" }, exec);
    await tools.writing_section_review.execute({ section: "1", comments: "ok", decision: "pass" }, exec);
    assert.equal((await readProjectFile(cwd, "状态测试")).sections[0].status, "reviewed");
    await tools.writing_section_save.execute({ section: "1", content: "只改个错别字。" }, exec);
    assert.equal((await readProjectFile(cwd, "状态测试")).sections[0].status, "reviewed");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("只记意见的审校不改变章节状态，decision=revise 才回退", async () => {
  const cwd = await tempBase();
  try {
    const tools = loadTools();
    const exec = fakeExec(cwd);
    await tools.writing_project_create.execute({ title: "审校测试", template: "weekly" }, exec);
    await tools.writing_section_save.execute({ section: "1", content: "正文。" }, exec);
    await tools.writing_section_review.execute({ section: "1", comments: "定稿", decision: "pass" }, exec);
    await tools.writing_assemble.execute({}, exec);
    assert.equal((await readProjectFile(cwd, "审校测试")).sections[0].status, "done");

    await tools.writing_section_review.execute({ section: "1", comments: "顺手记一笔" }, exec);
    assert.equal((await readProjectFile(cwd, "审校测试")).sections[0].status, "done");

    await tools.writing_section_review.execute({ section: "1", comments: "这里要重写", decision: "revise" }, exec);
    assert.equal((await readProjectFile(cwd, "审校测试")).sections[0].status, "drafting");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("汇编只把已审校的章节定稿，未审校的草稿保持原状态", async () => {
  const cwd = await tempBase();
  try {
    const tools = loadTools();
    const exec = fakeExec(cwd);
    await tools.writing_project_create.execute({ title: "汇编测试", template: "weekly" }, exec);
    await tools.writing_section_save.execute({ section: "1", content: "第一节。" }, exec);
    await tools.writing_section_review.execute({ section: "1", comments: "ok", decision: "pass" }, exec);
    await tools.writing_section_save.execute({ section: "2", content: "第二节，未审校。" }, exec);

    await tools.writing_assemble.execute({}, exec);
    const project = await readProjectFile(cwd, "汇编测试");
    assert.equal(project.sections[0].status, "done");
    assert.equal(project.sections[1].status, "drafted");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("有多个项目时不再猜最近修改的那个", async () => {
  const cwd = await tempBase();
  try {
    const tools = loadTools();
    await tools.writing_project_create.execute({ title: "甲", template: "weekly" }, fakeExec(cwd, "s1"));
    await tools.writing_project_create.execute({ title: "乙", template: "weekly" }, fakeExec(cwd, "s1"));
    await assert.rejects(
      tools.writing_status.execute({}, fakeExec(cwd, "s2")),
      /请显式传 project/,
    );
    await tools.writing_status.execute({ project: "甲" }, fakeExec(cwd, "s2"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

/* ────────────────────────── 文本与文件名 ────────────────────────── */

test("countWords 覆盖假名、谚文与扩展区汉字", () => {
  assert.equal(countWords("你好世界"), 4);
  assert.equal(countWords("hello world"), 2);
  assert.equal(countWords("𠀋𠮷"), 2);
  assert.ok(countWords("コーヒー") > 0, "假名应为正数");
  assert.ok(countWords("한글") > 0, "谚文应为正数");
  assert.equal(countWords("DeepSeek Harness 很好用"), 2 + 3);
});

test("slugify 不劈开代理对，并避开 Windows 设备名", () => {
  const key = slugify(`a${"😀".repeat(40)}`);
  assert.ok(Array.from(key).length <= 60, `按码点截断，实际 ${Array.from(key).length}`);
  assert.ok(key.isWellFormed(), "不应留下孤立代理码元");
  assert.equal(slugify("CON"), "_CON");
  assert.equal(slugify("aux"), "_aux");
  assert.match(slugify("   "), /^project-/);
});

/* ────────────────────────── 项目文件健壮性 ────────────────────────── */

test("readProject 拒绝版本过新的项目文件", async () => {
  const dir = await tempBase();
  try {
    const file = path.join(dir, "future.json");
    await writeFile(file, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, sections: [] }));
    await assert.rejects(readProject(file), /高于本插件支持/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readProject 对坏章节给出可读错误，并规范化缺失字段", async () => {
  const dir = await tempBase();
  try {
    const broken = path.join(dir, "broken.json");
    await writeFile(broken, JSON.stringify({ schemaVersion: 1, sections: [null] }));
    await assert.rejects(readProject(broken), /第 1 个章节不是对象/);

    const sparse = path.join(dir, "sparse.json");
    await writeFile(sparse, JSON.stringify({ schemaVersion: 1, sections: [{ content: "只有正文" }] }));
    const project = await readProject(sparse);
    assert.equal(project.schemaVersion, SCHEMA_VERSION);
    assert.equal(project.sections[0].id, "s1");
    assert.equal(project.sections[0].status, "planned");
    assert.equal(project.sections[0].words, 4);
    assert.deepEqual(project.sections[0].reviewNotes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
