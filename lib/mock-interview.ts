import { callLLM, callLLMObject } from "@/lib/llm";

/**
 * 模拟面试的对话。
 *
 * 和出题（lib/generate-questions.ts）的根本区别：
 * 出题是一次性列一批，面试官不知道你会怎么答；
 * 这里是**顺着你的回答临场决定下一问**——你说得含糊就追具体，
 * 你报了个数字就问怎么来的，你绕开了就把问题再递一次。
 *
 * 这才是真实面试的样子，也是 Studio 那套预生成题库覆盖不到的部分。
 */

export interface MockContext {
  role: {
    title: string;
    kind: string;
    domain: string | null;
    responsibilities: string[];
    requirements: string[];
    keywords: string[];
    variance: string[];
  } | null;
  /** 粘进来的 JD 原文，还没建画像时用 */
  rawJd: string | null;
  experiences: { title: string; summary: string; detail: string }[];
  /** 面经里这个方向真被问过的题 */
  wildQuestions: string[];
  /** 已经问过的轮次 */
  history: { role: "interviewer" | "me"; content: string }[];
}

function systemFor(ctx: MockContext): string {
  const roleLine = ctx.role
    ? `你在面的岗位是「${ctx.role.title}」${
        ctx.role.kind === "domain" ? `，业务域：${ctx.role.domain}` : "（通用型）"
      }。
职责：${ctx.role.responsibilities.join("；")}
硬性要求：${ctx.role.requirements.join("；")}
${ctx.role.variance.length ? `各家侧重：${ctx.role.variance.join("；")}` : ""}`
    : ctx.rawJd
      ? `这次面试的 JD 原文：\n${ctx.rawJd.slice(0, 4000)}`
      : "这次没有给具体 JD，按通用 AI 产品经理岗来面。";

  const expBlock = ctx.experiences
    .map((e) => `### ${e.title}\n${e.summary}\n${e.detail.slice(0, 1200)}`)
    .join("\n\n");

  const wildBlock = ctx.wildQuestions.length
    ? `\n\n## 这个方向别人真被问过的题（参照，别照抄）\n${ctx.wildQuestions
        .slice(0, 25)
        .map((q) => `- ${q}`)
        .join("\n")}`
    : "";

  return `你是**这个岗位上干了七八年的资深从业者**，现在在面试一个候选人。

${roleLine}

## 候选人的简历（他真做过的事）

${expBlock}${wildBlock}

## 你怎么问

**一次只问一个问题。** 问完就停，等他答。不要一口气列三个问题，
真实面试里没人那么问。

**顺着他的回答走。** 这是你和一份预生成题库的区别：
- 他说得含糊（「我负责了整体设计」）→ 追具体：「具体哪一段是你定的？」
- 他报了个数字（「准确率 98%」）→ 问来源：「这 98% 怎么算的？标注集多大？」
- 他绕开了你的问题 → 把问题再递一次，别放过：「我想问的其实是……」
- 他答得扎实 → 往深了推一层，或者换个角度检验
- 他明显没做过 → 问迁移：「你没做过 X，但做过 Y，你觉得能迁移吗？」

**专业度是硬要求。** 他简历里的概念你要真懂：
他说做了因果推断，你该问「识别策略是 DID 还是断点回归？平行趋势怎么检验的？」，
不是「讲讲你的因果推断项目」。外行的问法他一眼能看出来。

## 面试节奏

开场先自我介绍（你的，一句话）+ 请他做自我介绍。
之后大致按：经历深挖 → 专业追问 → 场景/假设题 → 留时间给他提问。
但不要机械推进，跟着对话走。

## 语气

像个人，不像题库。可以有反应：「这个做法有意思」「等一下，我没太跟上」。
不要每次都用「好的，那么下一个问题」这种主持人腔。
不要夸他，也不要故意为难——你只是想弄清楚这个人行不行。

**只输出你要说的话，不要加任何解释、标注或格式标记。**`;
}

/** 面试官的下一句 */
export async function nextTurn(ctx: MockContext): Promise<string> {
  const convo = ctx.history
    .map((t) => `${t.role === "interviewer" ? "面试官" : "候选人"}：${t.content}`)
    .join("\n\n");

  const prompt =
    ctx.history.length === 0
      ? "面试开始了。说开场白，并请他做自我介绍。"
      : `${convo}\n\n---\n轮到你说话了。只说这一句。`;

  const { text } = await callLLM("generate", prompt, {
    system: systemFor(ctx),
    maxOutputTokens: 1200,
  });
  return text.trim();
}

/* ────────── 结束后把这一场问过的题沉淀进题库 ────────── */

const HARVEST_SYSTEM = `从一场模拟面试的记录里，把**面试官问过的题**抽出来，
整理成能进题库的形式。

- 只抽真正的问题，开场白、过渡语、「明白了」这类不算。
- 追问要挂到主问题上：follows 填主问题在你输出数组里的下标，主问题填 null。
- scope：universal（换个岗位也会问，问的是这个人）/
  domain（这个业务域特有）。
- kind：behavioral / technical / case / resume / other
- cluster：英文小写下划线，同类题归一簇
- rationale：用面试官口吻写「我为什么问这题」，一句话

保留原本的问法，不要改写成书面语——那是他真实会听到的样子。`;

const HARVEST_SCHEMA = {
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
          cluster: { type: "string" },
          rationale: { type: "string" },
          follows: { type: ["integer", "null"] },
        },
        required: ["text", "kind", "scope", "cluster", "rationale", "follows"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export interface HarvestedQuestion {
  text: string;
  kind: string;
  scope: "universal" | "domain";
  cluster: string | null;
  rationale: string | null;
  follows: number | null;
}

export async function harvestQuestions(
  history: { role: "interviewer" | "me"; content: string }[]
): Promise<HarvestedQuestion[]> {
  const convo = history
    .map((t) => `${t.role === "interviewer" ? "面试官" : "候选人"}：${t.content}`)
    .join("\n\n");

  const { object } = await callLLMObject<{
    questions: {
      text: string;
      kind: string;
      scope: string;
      cluster: string;
      rationale: string;
      follows: number | null;
    }[];
  }>("extract", convo, HARVEST_SCHEMA, {
    system: HARVEST_SYSTEM,
    maxOutputTokens: 8000,
  });

  const KINDS = ["behavioral", "technical", "case", "resume", "other"];
  const raw = (object.questions ?? []).map((q, i) => ({
    i,
    text: (q.text ?? "").trim(),
    kind: KINDS.includes(q.kind) ? q.kind : "other",
    scope: (q.scope === "domain" ? "domain" : "universal") as "universal" | "domain",
    cluster: (q.cluster ?? "").trim() || null,
    rationale: (q.rationale ?? "").trim() || null,
    rawFollows:
      typeof q.follows === "number" && q.follows >= 0 && q.follows < i ? q.follows : null,
  }));

  const kept = raw.filter((q) => q.text);
  const map = new Map(kept.map((q, i) => [q.i, i] as const));
  return kept.map(({ i: _i, rawFollows, ...row }) => ({
    ...row,
    follows: rawFollows !== null ? (map.get(rawFollows) ?? null) : null,
  }));
}
