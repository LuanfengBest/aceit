import { callLLMObject } from "@/lib/llm";

/**
 * 语音陪练的评点。
 *
 * 评点的四个维度是有讲究的：
 * 前两个（有没有正面回答、数字对不对得上经历库）是**事实判断**，答错了就是硬伤；
 * 后两个（结构、语速口头禅）是**表达问题**，改起来容易。
 * 分开报是为了让人知道哪些必须改、哪些是锦上添花。
 */
export interface Critique {
  /** 0-100，只做粗略参考，不要当成分数体系 */
  score: number;
  answered: { ok: boolean; note: string };
  grounded: { ok: boolean; note: string };
  structure: { ok: boolean; note: string };
  delivery: { ok: boolean; note: string };
  /** 下一版该怎么改，一句话 */
  nextStep: string;
  /** 打磨后的书面版，直接可存成新版本 */
  polished: string;
}

const SYSTEM = `你在给一段面试口头回答做评点。

给你：题目、候选人的经历库（他真做过的事）、他刚才说的话（语音转写）。
转写会有口语的散乱、重复、语气词，这是正常的，不要因为不书面就扣分。

从四个维度看：

1. answered —— **有没有正面回答这道题**。
   最常见的问题是答偏：问「你怎么衡量成功」，答成「我们做了什么功能」。
   这一条不过关，后面三条再好也没用。

2. grounded —— **说的事和数字，经历库里对得上吗**。
   经历库里没有的项目、没有的指标、没有的数字，就是编的。面试里编数字是重伤。
   对不上的具体指出来：他说了什么，经历库里实际是什么。
   经历库里有但他没说出来的亮点，也在这里提醒。

3. structure —— **听得懂吗**。有没有先给结论，背景-动作-结果有没有交代清楚，
   有没有说到一半跳走。

4. delivery —— **口头表达**。口头禅（「就是」「然后」「那个」）频率、
   有没有绕、长度合不合适（一般 1-2 分钟，太短显得没料，太长面试官会打断）。

每一维给 ok（过没过）和 note（具体说问题在哪，或者哪里做得好）。
note 要具体，别说「可以更清晰」这种废话——指出是哪一句、该怎么说。

nextStep：下一版最该改的**一件事**，一句话。别列清单，一次改一个点。

polished：把他说的话整理成书面版。
**只能用他说过的内容和经历库里有的事实**，不要替他加没说过的东西。
口语的散乱理顺、重复删掉、结构补齐，但信息不增不减。
如果他答得实在太少（不到三句话），polished 就留空字符串。`;

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    answered: {
      type: "object",
      properties: { ok: { type: "boolean" }, note: { type: "string" } },
      required: ["ok", "note"],
      additionalProperties: false,
    },
    grounded: {
      type: "object",
      properties: { ok: { type: "boolean" }, note: { type: "string" } },
      required: ["ok", "note"],
      additionalProperties: false,
    },
    structure: {
      type: "object",
      properties: { ok: { type: "boolean" }, note: { type: "string" } },
      required: ["ok", "note"],
      additionalProperties: false,
    },
    delivery: {
      type: "object",
      properties: { ok: { type: "boolean" }, note: { type: "string" } },
      required: ["ok", "note"],
      additionalProperties: false,
    },
    next_step: { type: "string" },
    polished: { type: "string" },
  },
  required: ["score", "answered", "grounded", "structure", "delivery", "next_step", "polished"],
  additionalProperties: false,
} as const;

export async function critiqueAnswer(input: {
  question: string;
  transcript: string;
  experiences: { title: string; summary: string; detail: string }[];
  /** 面经里别人怎么答的，作为参照，不是标准答案 */
  reference?: { title: string; content: string; source: string }[];
}): Promise<Critique> {
  const expBlock = input.experiences.length
    ? input.experiences
        .map((e) => `### ${e.title}\n${e.summary}\n${e.detail.slice(0, 1200)}`)
        .join("\n\n")
    : "（经历库是空的，grounded 这一维只能判断有没有明显编造）";

  const refBlock = input.reference?.length
    ? `\n\n## 面经里别人是怎么答这道题的（参照，不是标准答案）\n${input.reference
        .map((r) => `- 【${r.title}】${r.content}\n  出处：${r.source}`)
        .join("\n")}`
    : "";

  const { object } = await callLLMObject<{
    score: number;
    answered: { ok: boolean; note: string };
    grounded: { ok: boolean; note: string };
    structure: { ok: boolean; note: string };
    delivery: { ok: boolean; note: string };
    next_step: string;
    polished: string;
  }>(
    "refine",
    `## 题目\n${input.question}\n\n## 他的经历库\n${expBlock}${refBlock}\n\n## 他刚才说的（语音转写）\n${input.transcript}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 8000 }
  );

  const dim = (d: { ok: boolean; note: string } | undefined) => ({
    ok: Boolean(d?.ok),
    note: (d?.note ?? "").trim(),
  });

  return {
    score: Math.max(0, Math.min(100, Math.round(object.score ?? 0))),
    answered: dim(object.answered),
    grounded: dim(object.grounded),
    structure: dim(object.structure),
    delivery: dim(object.delivery),
    nextStep: (object.next_step ?? "").trim(),
    polished: (object.polished ?? "").trim(),
  };
}
