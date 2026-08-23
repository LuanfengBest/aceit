import { callLLMObject } from "@/lib/llm";

/**
 * 按指令补题。
 *
 * 和 generate-questions 的区别：那个是一次铺一批，覆盖面优先；
 * 这个是**你说要什么就出什么**——「LLM-Wiki 那段问得太浅，
 * 针对读写分离再来五道」「出几道逼我想迁移路径的」。
 *
 * 还有一个关键差别：这里给经历**全文**，不截断。
 * 铺一批的时候 14 条经历每条只能给 1500 字，
 * 一万五千字的知识库项目只露了个开头，模型看到的是项目背景、
 * 看不到里面的技术决策，自然问不出东西——那正是覆盖率只有 6/14 的原因。
 * 聚焦到一条就没这个问题了。
 *
 * 出来的题**先不落库**，由人挑完再存。补题是个反复的动作，
 * 每次都直接写进题库会越攒越脏。
 */

const SYSTEM = `你是**这个岗位上干了七八年的资深从业者**，正在为一场面试补几道题。

使用者会告诉你他想补什么。照他说的出，不要自作主张换方向。

**专业度是硬要求。** 他经历里出现的专业概念你要真懂，问到点子上：
- 说做了因果推断 → 问「识别策略是 DID 还是断点回归？平行趋势怎么检验的？」
- 说搭了 RAG → 问「召回是稀疏还是稠密？多跳怎么解？评测集怎么建的」
外行的问法一眼能看出来，那种题练了没用。

出题时想的是：**这段经历里，哪个地方我会怀疑他说不清？**
- 哪个数字需要问来源
- 哪个决策我会想知道「为什么不是另一种做法」
- 哪个环节听起来顺，但真做过的人知道那儿一定有坑

追问：主问题后面可以跟 1-2 个追问，follows 填主问题在数组里的下标，
主问题填 null。追问要能问出主问题答不出来的东西。

字段：
- kind：behavioral / technical / case / resume / other
- scope：universal（换个岗位也会问）/ domain（这个业务域特有）
- rationale：用面试官口吻写「我为什么问这题」，一句话。
  写「想确认这个 90% 是怎么算的，还是拍的」，不要写「考察数据严谨性」
- cluster：英文小写下划线

按他要的数量出。他没说数量就出 4-6 道主问题。宁可少而准。`;

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: {
            type: "string",
            enum: ["behavioral", "technical", "case", "resume", "other"],
          },
          scope: { type: "string", enum: ["universal", "domain"] },
          rationale: { type: "string" },
          cluster: { type: "string" },
          follows: { type: ["integer", "null"] },
        },
        required: ["text", "kind", "scope", "rationale", "cluster", "follows"],
        additionalProperties: false,
      },
    },
    note: {
      type: "string",
      description: "一句话说明你是怎么理解这个要求的，让人知道方向对不对",
    },
  },
  required: ["questions", "note"],
  additionalProperties: false,
} as const;

export interface Suggested {
  text: string;
  kind: string;
  scope: "universal" | "domain";
  rationale: string | null;
  cluster: string | null;
  follows: number | null;
}

export async function suggestQuestions(input: {
  instruction: string;
  role: {
    title: string;
    domain: string | null;
    requirements: string[];
    variance: string[];
  } | null;
  /** 聚焦的那条经历，给全文 */
  focus: { title: string; summary: string; detail: string } | null;
  /** 其余经历只给标题摘要，作为背景 */
  others: { title: string; summary: string }[];
  existing: string[];
}): Promise<{ questions: Suggested[]; note: string }> {
  const roleBlock = input.role
    ? `## 岗位\n${input.role.title}${
        input.role.domain ? `（业务域：${input.role.domain}）` : ""
      }\n硬性要求：${input.role.requirements.join("；")}\n${
        input.role.variance.length ? `各家侧重：${input.role.variance.join("；")}` : ""
      }`
    : "## 岗位\n（没指定，按通用 AI 产品经理岗）";

  // 聚焦的那条给全文——不截断是这个功能的意义所在
  const focusBlock = input.focus
    ? `## 这次要问的这段经历（全文）\n### ${input.focus.title}\n${input.focus.summary}\n\n${input.focus.detail}`
    : "";

  const othersBlock = input.others.length
    ? `\n\n## 他的其他经历（只列标题，帮你判断哪些是他真做过的）\n${input.others
        .map((e) => `- ${e.title}：${e.summary}`)
        .join("\n")}`
    : "";

  const existingBlock = input.existing.length
    ? `\n\n## 题库里已经有的题（别重复出）\n${input.existing
        .slice(0, 60)
        .map((q) => `- ${q}`)
        .join("\n")}`
    : "";

  const { object } = await callLLMObject<{
    questions: {
      text: string;
      kind: string;
      scope: string;
      rationale: string;
      cluster: string;
      follows: number | null;
    }[];
    note: string;
  }>(
    "generate",
    `${roleBlock}\n\n${focusBlock}${othersBlock}${existingBlock}\n\n## 他的要求\n${input.instruction}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 12000 }
  );

  const KINDS = ["behavioral", "technical", "case", "resume", "other"];
  const raw = (object.questions ?? []).map((q, i) => ({
    i,
    text: (q.text ?? "").trim(),
    kind: KINDS.includes(q.kind) ? q.kind : "other",
    scope: (q.scope === "domain" ? "domain" : "universal") as "universal" | "domain",
    rationale: (q.rationale ?? "").trim() || null,
    cluster: (q.cluster ?? "").trim() || null,
    rawFollows:
      typeof q.follows === "number" && q.follows >= 0 && q.follows < i ? q.follows : null,
  }));

  const kept = raw.filter((q) => q.text);
  const map = new Map(kept.map((q, i) => [q.i, i] as const));

  return {
    note: (object.note ?? "").trim(),
    questions: kept.map(({ i: _i, rawFollows, ...row }) => ({
      ...row,
      follows: rawFollows !== null ? (map.get(rawFollows) ?? null) : null,
    })),
  };
}
