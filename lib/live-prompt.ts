import { callLLMObject } from "@/lib/llm";

/**
 * 面试进行中的实时提词。
 *
 * 为什么不用浏览器的 SpeechRecognition：它只听系统默认输入设备，
 * 不接受指定的 MediaStream。标签页音频（面试官的声音）喂不进去。
 * 装 BlackHole 把标签页声音路由成默认输入可以绕开，但那要手动配声卡。
 *
 * 走的是本地 whisper 切片：8 秒一段录、一段一段转。
 * 实测 medium 模型转 8 秒音频要 2.2 秒，加上出框架，
 * 从对方问完到屏幕上出提示大约 4-5 秒——够用，而且不用配任何东西。
 *
 * 最有价值的其实不是现出框架，是**查你自己练过的答案**：
 * 那一步不调模型，纯查库，瞬时。
 */

const SYSTEM = `你在给一场正在进行的面试做实时提词。

给你最近这段对话的转写（whisper 出的，会有错字和断句问题，别纠结字面）。
判断**面试官刚刚问了一个问题吗**。

- 是一个真问题（在问候选人某件事）→ asked 填 true，question 写清楚他问的是什么
- 只是寒暄、过渡、自己在说话、或者候选人还在答上一题 → asked 填 false，其余留空

如果是问题，给一个**能瞄一眼就用的答题框架**：
- points：3-4 条，每条一句话，是**说什么**不是**怎么说**。
  写「先给结论：这个决策的核心权衡是 X」，不要写「注意条理清晰」
- useStory：从他的经历库里挑最该用的那一段，写标题。挑不到填空字符串
- watchOut：这道题最容易翻车的地方，一句话。没有明显的坑就留空

**紧急情况下人只会扫一眼。**每条控制在 20 字以内，别写段落。
只用经历库里真有的东西，不要编项目和数字——面试中念出一个不存在的数字是重伤。

最后：输入里会给一份**他已经练过的题**。如果刚问的这道题和其中某一道
问的是同一件事，把那道题的 id 填进 matches_id——他打磨过的答案比你现出的框架
靠谱得多，要优先摆给他。不是同一件事就填 null，宁可不配。`;

const SCHEMA = {
  type: "object",
  properties: {
    asked: { type: "boolean" },
    question: { type: "string" },
    points: { type: "array", items: { type: "string" } },
    matches_id: {
      type: ["integer", "null"],
      description: "和「已经练过的题」里哪一道是同一件事，填 id；没有填 null",
    },
    use_story: { type: "string" },
    watch_out: { type: "string" },
  },
  required: ["asked", "question", "points", "matches_id", "use_story", "watch_out"],
  additionalProperties: false,
} as const;

export interface LivePrompt {
  asked: boolean;
  question: string;
  /** 和已经练过的哪道题是同一件事 */
  matchesId: number | null;
  points: string[];
  useStory: string;
  watchOut: string;
}

export async function livePrompt(input: {
  /** 最近这段转写 */
  recent: string;
  experiences: { title: string; summary: string }[];
  role: { title: string; domain: string | null } | null;
  /**
   * 他已经练过的题。让模型来配，不用文本相似度——
   * 面试官换个说法（「请做一下自我介绍」→「简单做个自我介绍，
   * 重点讲讲你负责过什么」）相似度就掉到 0.33，配不上
   */
  answered: { id: number; text: string }[];
}): Promise<LivePrompt> {
  const expBlock = input.experiences
    .map((e) => `- ${e.title}：${e.summary}`)
    .join("\n");

  const roleLine = input.role
    ? `面的是「${input.role.title}」${input.role.domain ? `（${input.role.domain}）` : ""}。`
    : "";

  const answeredBlock = input.answered.length
    ? `\n\n## 他已经练过的题（问到同一件事就填 matches_id）\n${input.answered
        .map((q) => `[id=${q.id}] ${q.text}`)
        .join("\n")}`
    : "";

  const { object } = await callLLMObject<{
    asked: boolean;
    question: string;
    points: string[];
    matches_id: number | null;
    use_story: string;
    watch_out: string;
  }>(
    "classify",
    `${roleLine}\n\n## 他的经历库\n${expBlock}${answeredBlock}\n\n## 最近这段对话\n${input.recent}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 1200 }
  );

  return {
    asked: Boolean(object.asked),
    question: (object.question ?? "").trim(),
    matchesId: input.answered.some((q) => q.id === object.matches_id)
      ? (object.matches_id as number)
      : null,
    points: (Array.isArray(object.points) ? object.points : [])
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 4),
    useStory: (object.use_story ?? "").trim(),
    watchOut: (object.watch_out ?? "").trim(),
  };
}
