import { callLLMObject } from "@/lib/llm";

/**
 * 把题关联到它在挖的那几条经历。
 *
 * 为什么单独做一步，而不是在出题时让模型顺手填：
 * 出题有三条路径（铺一批 / 按指令补题 / mock 结束后沉淀），
 * 各改一遍容易漏；而且就算都改了，存量的一百多道题还是空的。
 * 做成独立的一步，回填和增量共用同一套逻辑，重跑也安全。
 *
 * 关联出来能回答一个很实际的问题：**哪几段经历还没人问过。**
 * 之前只能靠感觉，实测 14 条里有 8 条一道题都没有。
 */

export interface QuestionLink {
  id: number;
  experienceIds: number[];
}

const SYSTEM = `把面试题关联到它在挖的那几条经历。

判断依据：**这道题要答好，得调用哪几段经历？**

- 题里点名了某个项目、某个数字、某个技术选择 → 关联那条经历。
  「Z-score 的阈值 1.5-2.0 怎么来的」→ 异动检测那条
- 题没点名，但只有某几段经历能答 → 也关联。
  「讲一个你推动跨团队的例子」→ 关联真的有跨团队协作的那几条
- 纯知识题、和他本人经历无关的 → 空数组。
  「意图识别和实体识别有什么区别」考的是概念，不挖经历
- 一道题可以关联多条，但别为了凑数硬关联——
  关联错了，覆盖统计就成了假的，那还不如没有

只用给你的 id，不要编。`;

const SCHEMA = {
  type: "object",
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_id: { type: "integer" },
          experience_ids: {
            type: "array",
            items: { type: "integer" },
            description: "这道题要答好得调用的经历 id；纯知识题填空数组",
          },
        },
        required: ["question_id", "experience_ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["links"],
  additionalProperties: false,
} as const;

/** 一次关联多少道。太多会让模型顾此失彼 */
const BATCH = 30;

export async function linkExperiences(
  questions: { id: number; text: string }[],
  experiences: { id: number; title: string; summary: string }[]
): Promise<QuestionLink[]> {
  if (questions.length === 0 || experiences.length === 0) return [];

  const expBlock = experiences
    .map((e) => `[id=${e.id}] ${e.title}\n    ${e.summary}`)
    .join("\n");

  const validExp = new Set(experiences.map((e) => e.id));
  const out: QuestionLink[] = [];

  for (let i = 0; i < questions.length; i += BATCH) {
    const batch = questions.slice(i, i + BATCH);
    const validQ = new Set(batch.map((q) => q.id));

    let object: { links: { question_id: number; experience_ids: number[] }[] };
    try {
      ({ object } = await callLLMObject<typeof object>(
        "classify",
        `## 他的经历库\n${expBlock}\n\n## 待关联的题\n${batch
          .map((q) => `[id=${q.id}] ${q.text}`)
          .join("\n")}`,
        SCHEMA,
        { system: SYSTEM, maxOutputTokens: 4000 }
      ));
    } catch {
      // 单批挂了不影响其他批
      continue;
    }

    for (const l of object.links ?? []) {
      if (!validQ.has(l.question_id)) continue;
      const ids = (Array.isArray(l.experience_ids) ? l.experience_ids : []).filter((x) =>
        validExp.has(x)
      );
      out.push({ id: l.question_id, experienceIds: [...new Set(ids)] });
    }
  }

  return out;
}
