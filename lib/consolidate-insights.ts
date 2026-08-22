import { callLLMObject } from "@/lib/llm";

const SYSTEM = `你在整理一堆从面经素材里抽出来的知识条目。素材是零散进来的，所以会有大量重复和碎片。

做两件事：

一、去重
- 说的是同一件事的，只保留信息最全的那条，其余标为重复（填 duplicate_of 为保留那条的 id）。
- 判断标准是**内容实质**，不是措辞。"讲项目要用STAR"和"按背景-目标-行动-结果展开"是同一条。
- 部分重叠但各有增量的，不算重复，都保留。

二、归主题
- 给每条分配一个 topic，把零散条目收进少数几个大主题里。
- **优先复用已有主题名**，只有实在装不下才新建。新建也要用宽的名字，别太细。
- 主题名用中文，4-10 字，如"讲项目的结构"、"AI搜索与RAG"、"指标与量化"、"面试官追问套路"。
- **主题数量有硬上限，见下面输入里给出的数字。** 超了就必须合并，宁可粗，不要细。
- 像"AI导购的反馈优化"和"AI导购与推荐的融合"这种，必须合并成一个更宽的主题。
  判断方法：如果两个主题名里有一半的字是重复的，它们就该合并。`;

const SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          topic: { type: "string", description: "归到哪个主题" },
          duplicate_of: {
            type: ["integer", "null"],
            description: "如果这条和别的重复，填保留那条的 id，否则 null",
          },
        },
        required: ["id", "topic", "duplicate_of"],
        additionalProperties: false,
      },
    },
  },
  required: ["assignments"],
  additionalProperties: false,
} as const;

export interface InsightBrief {
  id: number;
  kind: string;
  title: string;
  content: string;
}

export interface Assignment {
  id: number;
  topic: string;
  duplicateOf: number | null;
}

export async function consolidateInsights(
  items: InsightBrief[],
  existingTopics: string[]
): Promise<Assignment[]> {
  if (items.length === 0) return [];

  const block = items
    .map((i) => `[id=${i.id}] (${i.kind}) ${i.title} —— ${i.content.slice(0, 220)}`)
    .join("\n");

  const cap = Math.max(4, Math.min(8, Math.ceil(items.length / 4)));
  const topicsBlock =
    existingTopics.length > 0
      ? `已有主题（优先复用）：\n${existingTopics.map((t) => `- ${t}`).join("\n")}`
      : "（还没有主题，你来定）";

  const { object } = await callLLMObject<{
    assignments: { id: number; topic: string; duplicate_of: number | null }[];
  }>("classify", `主题数量上限：${cap} 个，超过就合并。\n\n${topicsBlock}\n\n## 待整理的条目\n${block}`, SCHEMA, {
    system: SYSTEM,
    maxOutputTokens: 8000,
  });

  const valid = new Set(items.map((i) => i.id));

  return (object.assignments ?? [])
    .filter((a) => valid.has(a.id))
    .map((a) => ({
      id: a.id,
      topic: (a.topic ?? "").trim() || "未分类",
      duplicateOf:
        typeof a.duplicate_of === "number" &&
        valid.has(a.duplicate_of) &&
        a.duplicate_of !== a.id
          ? a.duplicate_of
          : null,
    }));
}

/** 面经题去重：同一簇里措辞不同但问的是同一件事的，只留一条 */
const Q_SYSTEM = `你在给一堆从不同面经里抽出来的面试题去重。**标准要严，宁可漏判也不要误判。**

只有在**问的完全是同一件事、答案会一模一样**时才算重复：
- 算重复："讲讲你做的AI导购项目" 和 "详细介绍一下你的电商导购经历"
- 算重复：同一道题在两篇面经里出现，措辞略有不同

以下**都不算重复**，全部保留：
- 同一个项目的不同追问角度。"项目指标是什么"和"如何衡量导购成功"和"AB实验关注哪些指标"是三道题，答案不同。
- 主问题和它的追问。"讲讲这个项目"和"（追问）你具体做了什么"是两道题。
- 同一主题但深度不同的题。"什么是RAG"和"RAG的召回率怎么优化"是两道题。

追问链是面经里最有价值的部分，不要把它压平。如果拿不准，就不标为重复。`;

const Q_SCHEMA = {
  type: "object",
  properties: {
    duplicates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "要删掉的重复题" },
          keep: { type: "integer", description: "保留哪一条" },
        },
        required: ["id", "keep"],
        additionalProperties: false,
      },
    },
  },
  required: ["duplicates"],
  additionalProperties: false,
} as const;

export async function findDuplicateQuestions(
  items: { id: number; text: string }[]
): Promise<{ id: number; keep: number }[]> {
  if (items.length < 2) return [];

  const { object } = await callLLMObject<{
    duplicates: { id: number; keep: number }[];
  }>(
    "classify",
    items.map((q) => `[id=${q.id}] ${q.text}`).join("\n"),
    Q_SCHEMA,
    { system: Q_SYSTEM, maxOutputTokens: 6000 }
  );

  const valid = new Set(items.map((i) => i.id));
  return (object.duplicates ?? []).filter(
    (d) => valid.has(d.id) && valid.has(d.keep) && d.id !== d.keep
  );
}


/** 给面经题归主题，复用 insights 那套主题名，两边对得上 */
const QT_SYSTEM = `给面试题分主题，把零散的题收进少数几个大主题里。

- **优先复用已有主题名**，实在装不下才新建。
- 主题名用中文 4-10 字，如"AI搜索与RAG"、"项目讲述"、"指标与实验"。
- 主题数量有硬上限，见输入里给出的数字。宁可粗，不要细。
- 追问和它的主问题应该归到同一个主题。`;

const QT_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          topic: { type: "string" },
        },
        required: ["id", "topic"],
        additionalProperties: false,
      },
    },
  },
  required: ["assignments"],
  additionalProperties: false,
} as const;

export async function assignQuestionTopics(
  items: { id: number; text: string }[],
  existingTopics: string[]
): Promise<{ id: number; topic: string }[]> {
  if (items.length === 0) return [];

  const topicsBlock =
    existingTopics.length > 0
      ? `已有主题（优先复用）：\n${existingTopics.map((t) => `- ${t}`).join("\n")}`
      : "（还没有主题，你来定）";

  const { object } = await callLLMObject<{
    assignments: { id: number; topic: string }[];
  }>(
    "classify",
    `主题数量上限：${Math.max(4, Math.min(8, Math.ceil(items.length / 3)))} 个。\n\n${topicsBlock}\n\n## 待归类的题\n${items.map((q) => `[id=${q.id}] ${q.text}`).join("\n")}`,
    QT_SCHEMA,
    { system: QT_SYSTEM, maxOutputTokens: 6000 }
  );

  const valid = new Set(items.map((i) => i.id));
  return (object.assignments ?? [])
    .filter((a) => valid.has(a.id))
    .map((a) => ({ id: a.id, topic: (a.topic ?? "").trim() || "未分类" }));
}

/** 主题攒多了就合并。输入一批主题名，输出「旧名 → 新名」的映射 */
const MERGE_SYSTEM = `把一批主题名合并成更少、更宽的主题。

- 语义接近的合并成一个，用其中最合适的名字，或者起一个更宽的新名。
- 合并后的数量必须不超过给定的上限。
- 每个旧主题都要有归属，不能漏。
- 主题名保持中文 4-10 字。`;

const MERGE_SCHEMA = {
  type: "object",
  properties: {
    mapping: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
  },
  required: ["mapping"],
  additionalProperties: false,
} as const;

export async function mergeTopics(
  topics: string[],
  cap: number
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (topics.length <= cap) return result;

  const { object } = await callLLMObject<{ mapping: { from: string; to: string }[] }>(
    "classify",
    `上限 ${cap} 个主题。\n\n现有主题：\n${topics.map((t) => `- ${t}`).join("\n")}`,
    MERGE_SCHEMA,
    { system: MERGE_SYSTEM, maxOutputTokens: 3000 }
  );

  const known = new Set(topics);
  for (const m of object.mapping ?? []) {
    const from = (m.from ?? "").trim();
    const to = (m.to ?? "").trim();
    if (known.has(from) && to && from !== to) result.set(from, to);
  }
  return result;
}
