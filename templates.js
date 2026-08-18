/**
 * templates.js —— 常用写作模板与风格枚举。
 *
 * 模板只提供“骨架”：默认大纲、默认风格参数和给模型的写作提示。
 * 真正的写作由模型完成，工具负责把项目、大纲、章节草稿和审校记录
 * 持久化到磁盘，让长篇写作可以跨轮次、跨压缩继续。
 */

/** 风格字段的可选值。 */
export const STYLE_ENUMS = Object.freeze({
  tone: Object.freeze([
    "专业严谨",
    "轻松幽默",
    "亲切温暖",
    "简洁正式",
    "激昂有力",
    "冷静客观",
    "叙事自然",
    "轻松种草",
    "清晰易懂",
  ]),
  audience: Object.freeze([
    "大众读者",
    "技术同行",
    "管理层",
    "决策者",
    "新手用户",
    "学生",
    "客户",
    "现场听众",
    "年轻大众",
  ]),
  language: Object.freeze(["中文", "英文", "中英混合"]),
  pov: Object.freeze(["第一人称", "第二人称", "第三人称", "无特定视角"]),
});

/** 所有可选风格字段及其默认值。 */
export const STYLE_DEFAULTS = Object.freeze({
  genre: "通用文章",
  tone: "专业严谨",
  audience: "大众读者",
  language: "中文",
  pov: "无特定视角",
  targetWords: 2000,
  sectionWords: 500,
  extra: "",
});

export const TEMPLATES = Object.freeze([
  {
    key: "wechat",
    name: "公众号文章",
    genre: "公众号文章",
    defaultStyle: {
      tone: "亲切有力",
      audience: "大众读者",
      language: "中文",
      pov: "第二人称",
      targetWords: 2000,
      sectionWords: 500,
    },
    outline: [
      { title: "开头钩子", goal: "用一个反常识问题、场景或数据抓住注意力，点出这篇文章能带给读者什么" },
      { title: "背景与痛点", goal: "解释读者为什么关心这件事，建立共鸣，说明不解决会怎样" },
      { title: "核心观点展开", goal: "给出 2-3 个小论点，每个论点配例子或数据支撑" },
      { title: "案例或故事", goal: "用一个具体、可感的人物或事件把观点讲活" },
      { title: "总结与行动建议", goal: "回扣开头，给读者一个立刻能做的行动，并引导转发或留言" },
    ],
    tips: "多用短句短段，每段 3-5 行；小标题要有信息量；结尾留互动钩子。",
  },
  {
    key: "tech-blog",
    name: "技术博客",
    genre: "技术博客",
    defaultStyle: {
      tone: "专业严谨",
      audience: "技术同行",
      language: "中文",
      pov: "第一人称",
      targetWords: 3500,
      sectionWords: 600,
    },
    outline: [
      { title: "摘要与背景", goal: "一句话说明解决什么问题，读者看完能得到什么" },
      { title: "问题分析", goal: "描述现状、痛点，以及已有方案的不足或权衡" },
      { title: "方案与原理", goal: "讲清核心思路、整体结构、关键设计取舍，配示意或伪代码" },
      { title: "实现步骤", goal: "给出可复现的步骤、命令与代码要点，标明环境要求" },
      { title: "踩坑与验证", goal: "记录易错点、测试结果或基准数据，说明结论的可信度" },
      { title: "总结与展望", goal: "收束结论，指出局限与后续优化方向" },
    ],
    tips: "代码块务必标注语言；概念先定义再使用；结论要给出验证方式。",
  },
  {
    key: "weekly",
    name: "工作周报",
    genre: "工作周报",
    defaultStyle: {
      tone: "简洁正式",
      audience: "管理层",
      language: "中文",
      pov: "第一人称",
      targetWords: 800,
      sectionWords: 200,
    },
    outline: [
      { title: "本周概览", goal: "一句话总结本周整体情况：完成了什么、整体是否按计划推进" },
      { title: "完成事项", goal: "按重要性列出完成事项，标注结果或产出链接" },
      { title: "数据与进展", goal: "给出关键指标、进度百分比或里程碑变化" },
      { title: "问题与风险", goal: "说明阻塞点、风险与影响，以及需要谁提供什么支持" },
      { title: "下周计划", goal: "列出下周目标与优先级，尽量可衡量" },
    ],
    tips: "先结论后细节；能用数字就不用形容词；风险要给出建议而不是只报问题。",
  },
  {
    key: "story",
    name: "小说章节",
    genre: "小说章节",
    defaultStyle: {
      tone: "叙事自然",
      audience: "大众读者",
      language: "中文",
      pov: "第三人称",
      targetWords: 3000,
      sectionWords: 600,
    },
    outline: [
      { title: "场景切入", goal: "交代时间、地点、氛围和视角人物，让读者迅速入戏" },
      { title: "事件推进", goal: "一件具体的事打破平静，人物做出选择，故事动起来" },
      { title: "冲突升级", goal: "给人物压力：对抗、误解、代价或新信息，让矛盾更尖锐" },
      { title: "情绪高点", goal: "本章高潮：关键场面、对白或内心转折，情绪推到顶点" },
      { title: "收束与悬念", goal: "给本章一个落点，埋下下一章的钩子" },
    ],
    tips: "少用抽象形容词，多用动作、对白和细节；视角人物保持一致；每节结尾留一点牵引。",
  },
  {
    key: "xiaohongshu",
    name: "小红书笔记",
    genre: "小红书笔记",
    defaultStyle: {
      tone: "轻松种草",
      audience: "年轻大众",
      language: "中文",
      pov: "第一人称",
      targetWords: 800,
      sectionWords: 160,
    },
    outline: [
      { title: "标题备选", goal: "给出 3 个吸睛标题方向，包含关键词和情绪点" },
      { title: "开头钩子", goal: "第一句话留住人：结果先行、反差或真实感受" },
      { title: "核心体验", goal: "3-5 个要点讲真实体验，有细节、有画面感" },
      { title: "避坑与建议", goal: "说明适合什么人、有什么坑、怎么选" },
      { title: "互动引导", goal: "给出 3-5 个话题标签，结尾用一个问题引导评论" },
    ],
    tips: "口语化、分行多、emoji 适度；每点先给结论再展开；标签要贴合内容。",
  },
  {
    key: "speech",
    name: "演讲稿",
    genre: "演讲稿",
    defaultStyle: {
      tone: "激昂有力",
      audience: "现场听众",
      language: "中文",
      pov: "第一人称",
      targetWords: 1800,
      sectionWords: 350,
    },
    outline: [
      { title: "开场白", goal: "问好、破冰，用一个问题或故事点出主题，建立与听众的连接" },
      { title: "核心主张", goal: "一句话说清主张，给出三个支撑点预告" },
      { title: "故事与案例", goal: "用亲身经历或动人故事支撑主张，让听众可感" },
      { title: "高潮金句", goal: "情绪最高点：排比、金句或反问，把主张推向顶点" },
      { title: "结尾号召", goal: "总结观点，给出明确、可执行的行动号召" },
    ],
    tips: "句子要能读出声：短句为主，有节奏；每节都想象听众的反应。",
  },
  {
    key: "report",
    name: "调研分析报告",
    genre: "调研分析报告",
    defaultStyle: {
      tone: "冷静客观",
      audience: "决策者",
      language: "中文",
      pov: "第三人称",
      targetWords: 4000,
      sectionWords: 650,
    },
    outline: [
      { title: "摘要", goal: "结论先行：一页看懂关键发现与建议" },
      { title: "背景与目标", goal: "说明调研范围、方法、数据来源和要回答的问题" },
      { title: "数据与分析", goal: "呈现事实与数据，说明分析口径，图表位置用占位说明" },
      { title: "关键发现", goal: "分条列出发现，每条附证据强度与例外情况" },
      { title: "结论与建议", goal: "给出可执行的建议，标注优先级、投入与预期收益" },
      { title: "附录", goal: "数据来源、口径定义、局限性与补充材料清单" },
    ],
    tips: "事实与判断分开写；每个发现都要有证据；建议要可执行、可验收。",
  },
  {
    key: "manual",
    name: "使用教程",
    genre: "使用教程",
    defaultStyle: {
      tone: "清晰易懂",
      audience: "新手用户",
      language: "中文",
      pov: "第二人称",
      targetWords: 2500,
      sectionWords: 500,
    },
    outline: [
      { title: "适用对象与准备", goal: "说明谁适合读、需要哪些前置条件与环境" },
      { title: "快速上手", goal: "给出最小可用路径，让读者十分钟内完成第一次成功操作" },
      { title: "分步详解", goal: "每个功能按步骤展开：做什么、怎么做、预期结果，截图处用占位标注" },
      { title: "常见问题", goal: "整理 FAQ 与常见报错的处理方法" },
      { title: "延伸阅读", goal: "进阶用法、相关资源和下一步学习路径" },
    ],
    tips: "一步一个动作，先说结果再说操作；命令和按钮名要原样标注；不要假设读者已经会。",
  },
]);

/** 按 key 查模板，找不到时抛错并列出可用 key。 */
export function templateByKey(key) {
  const found = TEMPLATES.find((t) => t.key === key);
  if (!found) {
    const keys = TEMPLATES.map((t) => `${t.key}（${t.name}）`).join("、");
    throw new Error(`未知模板 "${key}"；可用模板：${keys}`);
  }
  return found;
}

/** 把模板默认风格补全为完整风格对象。 */
export function styleFromTemplate(template) {
  return {
    ...STYLE_DEFAULTS,
    ...(template.defaultStyle ?? {}),
    genre: template.genre,
  };
}

/** 校验并应用一次风格补丁（只允许已知字段，未知字段直接报错）。 */
export function applyStylePatch(style, patch) {
  if (patch === undefined || patch === null) return style;
  if (typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("style 必须是对象，例如 { tone: \"轻松幽默\", targetWords: 3000 }");
  }
  const next = { ...style };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!(key in STYLE_DEFAULTS)) {
      throw new Error(`未知风格字段 "${key}"；可用字段：${Object.keys(STYLE_DEFAULTS).join("、")}`);
    }
    if (key in STYLE_ENUMS) {
      const allowed = STYLE_ENUMS[key];
      if (typeof value !== "string" || !allowed.includes(value)) {
        throw new Error(`风格字段 ${key} 必须是 ${allowed.join(" / ")} 之一，收到 "${String(value)}"`);
      }
      next[key] = value;
    } else if (key === "targetWords" || key === "sectionWords") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 50 || value > 100000) {
        throw new Error(`风格字段 ${key} 必须是 50-100000 之间的整数，收到 ${JSON.stringify(value)}`);
      }
      next[key] = value;
    } else {
      if (typeof value !== "string") throw new Error(`风格字段 ${key} 必须是字符串`);
      next[key] = value;
    }
  }
  return next;
}
