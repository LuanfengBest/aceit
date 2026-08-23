import { callLLMObject } from "@/lib/llm";

const BASE_RULES = `你在帮候选人打磨面试答案。

铁律：
- **只能用候选人经历库里真实存在的内容**。不许编造项目、数字、职级、时间。
- 经历库里没有的信息，宁可不说，也不要圆场。如果这题他确实没有对应经历，就用他最接近的经历诚实作答，并在 gaps 里说明。
- 数字要用经历库里写过的原始数字，不许四舍五入成更好看的数。

写法：
- 用第一人称口语，像在面试里说话，不是书面报告。
- 结构走 STAR 但不要把"情境/任务/行动/结果"当小标题写出来，自然叙述。
- 长度控制在口述 90-150 秒（约 300-450 字）。
- 开头一句直接切入是哪件事，别铺垫。
- 结果部分必须有具体数字或可验证的变化。

字段边界（重要）：
- content 里**只写答案正文本身**，写完整、以句号收尾。不要在 content 里讨论素材够不够、有什么局限、"要说gap的话"之类——那些一个字都不要出现在 content 里。
- 素材缺什么、哪里是推测而非实测，全部写进 gaps 字段。
- used_experience_ids 填你实际用到的经历编号（就是给你的列表里的 [n]）。`;

const SCHEMA = {
  type: "object",
  properties: {
    content: { type: "string", description: "面试时口述的答案" },
    used_experience_ids: {
      type: "array",
      items: { type: "integer" },
      description: "用到的经历编号",
    },
    gaps: {
      type: "string",
      description: "经历库里缺什么导致这题答得不够硬；没有就填空字符串",
    },
  },
  required: ["content", "used_experience_ids", "gaps"],
  additionalProperties: false,
} as const;

const PICK_SYSTEM = `你在为一道面试题挑选素材。

给你候选人的全部经历（只有标题和摘要）和一道面试题。
选出**回答这道题最该用的 2-4 条**，按相关度排序。
- 优先选能构成完整叙事（有背景、动作、结果）的那几条。
- 宁可少选也不要凑数：塞进去不相关的经历会让答案发散。
- 如果没有任何一条真的对得上，就选最接近的 1-2 条。`;

const PICK_SCHEMA = {
  type: "object",
  properties: {
    ids: { type: "array", items: { type: "integer" }, description: "选中的经历编号，按相关度排序" },
  },
  required: ["ids"],
  additionalProperties: false,
} as const;

/**
 * 先选材再写答案。
 * 全量把 20+ 条经历的原文塞进去会把模型的输出挤没（实测只吐 142 字就断句），
 * 而且违背"按问题类型精准调用某几条"的设计。
 */
export async function pickExperiences(
  question: string,
  experiences: ExperienceRef[],
  limit = 4
): Promise<ExperienceRef[]> {
  if (experiences.length <= limit) return experiences;

  const brief = experiences
    .map((e) => `[${e.id}] ${e.title} — ${e.summary}`)
    .join("\n");

  try {
    const { object } = await callLLMObject<{ ids: number[] }>(
      "classify",
      `面试题：${question}\n\n## 候选经历\n${brief}`,
      PICK_SCHEMA,
      { system: PICK_SYSTEM, maxOutputTokens: 1000 }
    );
    const byId = new Map(experiences.map((e) => [e.id, e]));
    const picked = (object.ids ?? [])
      .map((id) => byId.get(id))
      .filter((e): e is ExperienceRef => e !== undefined)
      .slice(0, limit);
    if (picked.length > 0) return picked;
  } catch {
    // 选材失败就退回前几条，别让整个流程挂掉
  }
  return experiences.slice(0, limit);
}

export interface AnswerResult {
  content: string;
  usedExperienceIds: number[];
  gaps: string;
}

/** 模型偶尔会把答案写一半就跳去写 gaps，收尾没有标点。检出来重试一次 */
function looksComplete(text: string): boolean {
  return /[。！？.!?」』）)]\s*$/.test(text.trim());
}

/** 重试后还是收不了尾，就截到最后一个完整句，别把断头话给用户 */
function trimToLastSentence(text: string): string {
  const trimmed = text.trim();
  if (looksComplete(trimmed)) return trimmed;
  const cut = Math.max(
    trimmed.lastIndexOf("。"),
    trimmed.lastIndexOf("！"),
    trimmed.lastIndexOf("？")
  );
  return cut > 40 ? trimmed.slice(0, cut + 1) : trimmed;
}

interface ExperienceRef {
  id: number;
  title: string;
  summary: string;
  detail: string;
}

function experienceBlock(experiences: ExperienceRef[]): string {
  return experiences
    .map(
      (e) =>
        `[${e.id}] ${e.title}\n   摘要：${e.summary}\n   原文：${e.detail.slice(0, 1200)}`
    )
    .join("\n\n");
}

/** 首版答案 */
export async function draftAnswer(
  question: string,
  roleTitle: string,
  experiences: ExperienceRef[],
  retried = false
): Promise<AnswerResult> {
  const picked = await pickExperiences(question, experiences);

  const { object } = await callLLMObject<{
    content: string;
    used_experience_ids: number[];
    gaps: string;
  }>(
    "generate",
    `面试岗位：${roleTitle}\n\n问题：${question}\n\n## 相关经历\n${experienceBlock(picked)}`,
    SCHEMA,
    { system: BASE_RULES, maxOutputTokens: 12000 }
  );

  const result = {
    content: (object.content ?? "").trim(),
    usedExperienceIds: Array.isArray(object.used_experience_ids)
      ? object.used_experience_ids.filter((n) => Number.isInteger(n))
      : [],
    gaps: (object.gaps ?? "").trim(),
  };

  if (!looksComplete(result.content) && !retried) {
    return draftAnswer(question, roleTitle, experiences, true);
  }
  return { ...result, content: trimToLastSentence(result.content) };
}

/** 按指令打磨出新一版 */
export async function refineAnswer(
  question: string,
  roleTitle: string,
  previous: string,
  instruction: string,
  experiences: ExperienceRef[]
): Promise<AnswerResult> {
  const picked = await pickExperiences(question, experiences);

  const { object } = await callLLMObject<{
    content: string;
    used_experience_ids: number[];
    gaps: string;
  }>(
    "refine",
    `面试岗位：${roleTitle}\n\n问题：${question}\n\n## 上一版答案\n${previous}\n\n## 打磨要求\n${instruction}\n\n## 相关经历\n${experienceBlock(picked)}`,
    SCHEMA,
    {
      system: `${BASE_RULES}\n\n这次是在已有答案上按要求改。保留上一版里好的部分，只改要求指向的地方，不要整篇重写。`,
      maxOutputTokens: 12000,
    }
  );

  return {
    content: trimToLastSentence(object.content ?? ""),
    usedExperienceIds: Array.isArray(object.used_experience_ids)
      ? object.used_experience_ids.filter((n) => Number.isInteger(n))
      : [],
    gaps: (object.gaps ?? "").trim(),
  };
}
