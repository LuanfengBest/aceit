import { callLLMObject } from "@/lib/llm";

/**
 * 把答法挂回它回答的那道题。
 *
 * 为什么要单独一步：素材是按单元读的（一张图一次），
 * 而面经常把题写在图 5、答法写在图 6。读图 6 的那次调用看不见图 5 的题，
 * 只能把答法当成通用知识吐出来。这一步拿到全部的题和全部悬空的答法，
 * 一次性配对——纯文本、任务单一，是模型最不容易出错的形态。
 */
export interface LinkCandidate {
  /** 在悬空答法数组里的位置 */
  index: number;
  title: string;
  content: string;
}

export interface LinkResult {
  index: number;
  questionIndex: number;
}

const SYSTEM = `把答法配对到它回答的那道题上。

给你一份题目清单和一份答法清单，都编了号。
对每一条答法，判断它回答的是清单里的哪一道题。

- 只有明确对应得上才配。答法讲的内容要正面回应那道题问的东西。
- 泛泛的方法论、公司情况、术语解释，对应不到具体某道题，question 填 null。
- 宁可不配，也不要勉强配。配错了使用者会在一道题下面看到答非所问的东西，
  比空着更糟。
- question_echo 填你配上的那道题的**前 12 个字**，照抄。这是给程序核对用的，
  填错了这一条会被丢掉。没配就填空字符串。`;

const SCHEMA = {
  type: "object",
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          answer: { type: "integer", description: "答法的编号（从 1 开始）" },
          question: {
            type: ["integer", "null"],
            description: "题的编号（从 1 开始）；配不上填 null",
          },
          question_echo: {
            type: "string",
            description: "配上的那道题的前 12 个字，照抄；没配填空字符串",
          },
        },
        required: ["answer", "question", "question_echo"],
        additionalProperties: false,
      },
    },
  },
  required: ["links"],
  additionalProperties: false,
} as const;

const normalize = (t: string) => t.replace(/[\s，。？?、,.:：；;""''「」]/g, "");

export async function linkAnswers(
  questions: string[],
  candidates: LinkCandidate[]
): Promise<LinkResult[]> {
  if (questions.length === 0 || candidates.length === 0) return [];

  const qBlock = questions.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const aBlock = candidates
    .map((c, i) => `${i + 1}. 【${c.title}】${c.content.slice(0, 200)}`)
    .join("\n");

  let object: { links: { answer: number; question: number | null; question_echo: string }[] };
  try {
    ({ object } = await callLLMObject<typeof object>(
      "classify",
      `## 题目清单\n${qBlock}\n\n## 待配对的答法\n${aBlock}`,
      SCHEMA,
      { system: SYSTEM, maxOutputTokens: 6000 }
    ));
  } catch {
    return [];
  }

  const out: LinkResult[] = [];
  for (const link of object.links ?? []) {
    const ai = (link.answer ?? 0) - 1;
    if (!candidates[ai]) continue;
    if (link.question === null || link.question === undefined) continue;

    const qi = link.question - 1;
    const echo = normalize(link.question_echo ?? "");
    if (!echo) continue;

    // 编号和回声对不上就按回声重新找——编号错位是模型最常犯的错，
    // 让它同时给编号和原文，就能互相校验
    let resolved = -1;
    if (questions[qi] && normalize(questions[qi]).startsWith(echo.slice(0, 8))) {
      resolved = qi;
    } else {
      resolved = questions.findIndex((q) => normalize(q).startsWith(echo.slice(0, 8)));
    }
    if (resolved < 0) continue;

    out.push({ index: candidates[ai].index, questionIndex: resolved });
  }
  return out;
}
