import { callLLMObject } from "@/lib/llm";

const SYSTEM = `你在整理一场真实面试的复盘记录。

给你：面试者粘贴的一段面试回忆（可能是流水账、可能是逐字稿），以及他问题库里已有的题。

任务：
1. 把这段文字拆成一道道**实际被问到的问题**，保留面试官原本的问法。
2. 如果他当时的回答也写了，一并提取；没写就留空。
3. 每道题去问题库里找**本质相同**的那一条，找到就填它的 id；措辞不同没关系，问的是同一件事就算匹配。真的没有就填 null——那说明这题他压根没准备过，这个信号很重要，不要硬凑。
4. reflection 写一句你的观察：这题他答得怎么样、缺什么。看不出来就留空。`;

const SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string", description: "公司名，看不出填空字符串" },
    round: { type: "string", description: "第几轮/什么面，看不出填空字符串" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          asked_text: { type: "string", description: "面试官的原本问法" },
          my_answer: { type: "string", description: "他当时怎么答的，没写就空字符串" },
          matched_question_id: {
            type: ["integer", "null"],
            description: "问题库里对应的 id，没有就 null",
          },
          reflection: { type: "string", description: "一句观察，看不出就空字符串" },
        },
        required: ["asked_text", "my_answer", "matched_question_id", "reflection"],
        additionalProperties: false,
      },
    },
  },
  required: ["company", "round", "items"],
  additionalProperties: false,
} as const;

export interface MatchedItem {
  askedText: string;
  myAnswer: string;
  matchedQuestionId: number | null;
  reflection: string;
}

export async function matchInterview(
  transcript: string,
  bank: { id: number; text: string }[]
): Promise<{ company: string; round: string; items: MatchedItem[] }> {
  const bankBlock =
    bank.length > 0
      ? bank.map((q) => `[id=${q.id}] ${q.text}`).join("\n")
      : "（问题库还是空的，全部填 null）";

  const { object } = await callLLMObject<{
    company: string;
    round: string;
    items: {
      asked_text: string;
      my_answer: string;
      matched_question_id: number | null;
      reflection: string;
    }[];
  }>(
    "extract",
    `## 面试回忆\n${transcript}\n\n## 已有问题库\n${bankBlock}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 8000 }
  );

  const valid = new Set(bank.map((q) => q.id));

  return {
    company: (object.company ?? "").trim(),
    round: (object.round ?? "").trim(),
    items: (object.items ?? [])
      .map((i) => ({
        askedText: (i.asked_text ?? "").trim(),
        myAnswer: (i.my_answer ?? "").trim(),
        matchedQuestionId:
          typeof i.matched_question_id === "number" && valid.has(i.matched_question_id)
            ? i.matched_question_id
            : null,
        reflection: (i.reflection ?? "").trim(),
      }))
      .filter((i) => i.askedText),
  };
}
