/**
 * schema-check.mjs —— 校验插件工具定义，并用假 ctx 完整跑一遍写作工作流。
 * 无需启动 dsh web。
 *
 * 安装了 devDependencies（npm install）时，会使用 harness 自带的
 * @deepseek-ai/dsh-tools 官方校验器；没有安装时降级为本地基本检查。
 *
 * 运行：node --test --test-isolation=none test/schema-check.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { apply } from "../index.js";

let assertSupportedJsonSchema;
try {
  ({ assertSupportedJsonSchema } = await import("@deepseek-ai/dsh-tools"));
} catch (error) {
  // CI 里缺了这个包就等于"零校验还绿"，必须硬失败；本地缺依赖只降级提示。
  if (process.env.CI) {
    throw new Error(
      `schema-check: CI 环境必须安装 @deepseek-ai/dsh-tools 才能运行官方 schema 校验（${error?.message ?? error}）`,
    );
  }
  console.warn(
    "schema-check: 未找到 @deepseek-ai/dsh-tools，跳过官方 JSON Schema 校验（运行 npm install 后恢复）",
  );
}

function loadTools() {
  const tools = [];
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    get: () => undefined,
  };
  apply(ctx, {});
  return tools;
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

test("注册 11 个工具且参数/输出 schema 通过校验", () => {
  const tools = loadTools();
  assert.equal(tools.length, 11);
  for (const tool of tools) {
    if (assertSupportedJsonSchema) {
      assertSupportedJsonSchema(tool.parameters);
      assertSupportedJsonSchema(tool.output.schema);
    } else {
      assert.equal(tool.parameters.type, "object");
      assert.ok(Array.isArray(tool.parameters.properties) === false);
      assert.equal(tool.output.schema.type, "string");
    }
    assert.equal(typeof tool.execute, "function");
    assert.equal(typeof tool.output.render, "function");
    assert.equal(tool.output.schema.type, "string");
  }
});

test("模拟会话完整跑通写作工作流", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "dsh-writing-e2e-"));
  try {
    const tools = loadTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const exec = fakeExec(cwd);

    const created = await byName.writing_project_create.execute(
      { title: "端到端测试文章", template: "wechat", thesis: "写作插件要可靠地保存进度" },
      exec,
    );
    assert.match(created, /已创建写作项目/);

    const list = await byName.writing_projects_list.execute({}, exec);
    assert.match(list, /端到端测试文章/);

    const saved = await byName.writing_section_save.execute(
      { section: "1", content: "这是第一节的正文草稿，用于端到端测试。" },
      exec,
    );
    assert.match(saved, /已保存第 1 节/);

    const reviewed = await byName.writing_section_review.execute(
      { section: "s1", comments: "开头不错，保持简洁。", decision: "pass" },
      exec,
    );
    assert.match(reviewed, /已定稿|审校/);

    const assembled = await byName.writing_assemble.execute({ only_reviewed: true }, exec);
    assert.match(assembled, /成稿已汇编/);

    const manuscript = path.join(cwd, ".writing-studio", "manuscripts", "端到端测试文章.md");
    const text = await readFile(manuscript, "utf8");
    assert.match(text, /端到端测试文章/);
    assert.match(text, /这是第一节的正文草稿/);
    assert.match(text, /^---$/m);

    const status = await byName.writing_status.execute({}, exec);
    assert.match(status, /1\/5 节完成/);

    const section = await byName.writing_section_read.execute({ section: "1" }, exec);
    assert.match(section, /这是第一节的正文草稿/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("参数校验失败时给出可读错误", async () => {
  const tools = loadTools();
  const cwd = await mkdtemp(path.join(tmpdir(), "dsh-writing-e2e-"));
  try {
    const exec = fakeExec(cwd);
    await assert.rejects(
      tools.find((t) => t.name === "writing_project_create").execute({ title: "x", template: "nope" }, exec),
      /未知模板/,
    );
    await assert.rejects(
      tools.find((t) => t.name === "writing_status").execute({}, exec),
      /还没有写作项目/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
