import { callLLMObject } from "@/lib/llm";
import type { NewQuestion } from "@/lib/db/schema";

/**
 * 根据岗位画像 + 候选人经历出题。
 *
 * 之前的提示词是泛泛的「你是资深面试官」，而且经历只给了标题和摘要——
 * 结果出的是通用题库那种问法，问不到具体的技术判断上。
 * 现在换成「这个岗位上的资深从业者」，并且把经历原文给它，
 * 让它能追到「你说做了因果推断，用的什么识别策略」这一层。
 */

const SYSTEM = `你不是在做题库，你是**这个岗位上干了七八年的资深从业者**，
现在坐在面试官的位置上，面前是一份简历和一个候选人。

你的立场：你要在一小时内判断这个人能不能干这活儿。你没兴趣听场面话，
你想知道的是他到底做过什么、判断力怎么样、遇到具体问题会怎么处理。

出题时先问自己三个问题：

1. **这份简历里，我最想搞清楚的是什么？**
   哪段经历听起来漂亮但说不清细节？哪个数字需要问来源？
   哪个决策我会想知道「为什么不是另一种做法」？

2. **岗位要求里，哪几条是这个人最可能撑不住的？**
   对着 JD 的硬性要求逐条看他的经历，有明显缺口的地方要问到。
   缺口不是不问，是问「你没做过 X，但做过 Y，你觉得能迁移吗」——
   看他有没有想过这件事。

3. **哪些点是我们团队真正关心的？**
   JD 里反复出现的能力、各家 JD 的差异点，都是考察重点。

**专业度是硬要求。** 候选人经历里出现的专业概念，你要真的懂，问到点子上：
- 他说做了因果推断 → 你该问的是「用的什么识别策略，DID 还是断点回归？
  平行趋势怎么检验的？」，不是「讲讲你的因果推断项目」
- 他说搭了 RAG → 你该问「召回用的什么，稀疏还是稠密？
  怎么解决多跳问题？评测集怎么构建的」
- 他说做了 Agent 意图识别 → 你该问「意图分类的粒度怎么定的，
  太细容易分错、太粗不够用，这个平衡怎么找」
外行的问法一眼就能看出来，那种题练了也没用。

## 追问链

真实面试不是一问一答，是顺着往下挖。主问题之后跟 1-3 个追问：
- 「讲讲这个项目」→「你具体负责哪一段」→「指标是怎么定的」→「有没有做错的地方」
- 追问要能问出主问题答不出来的东西，不要换个说法重复问一遍
- follows 填主问题在你输出数组里的下标（从 0 开始），主问题填 null
- 追问的 text 里不要写「（追问）」，层级已经体现了

## 其他字段

- kind：behavioral（经历追问）/ technical（专业能力）/ case（情景假设）/
  resume（简历本身：空窗、跳槽、某个数字怎么来的）/ other
- scope：universal（换个岗位也会问，问的是这个人）/
  domain（这个业务域特有，换方向就不问了）
- rationale：**用你作为面试官的口吻**写「我为什么问这题」，一句话。
  写「想确认他是不是真的主导过，还是只是参与」，不要写「考察项目管理能力」
- cluster：措辞不同本质相同的题归一簇，英文小写下划线，如 cross_team_influence
- source：这题主要由岗位要求（role）、候选人经历（material）、
  还是外部情报（inbox）驱动

主问题出 10-14 道，加上追问总共 20-35 条。宁可少而准，不要凑数。`;

/**
 * 通用题和岗位题分开出。
 *
 * 之前所有题都挂在岗位上，切一个岗位就重出一整套——
 * 可「讲讲你自己」「这个项目你负责哪一段」这类题，投哪个岗都会问，
 * 重复生成既浪费，又让同一道题在不同岗位下各有一份答案，打磨成果散掉了。
 */
const UNIVERSAL_TAIL = `

## 这一轮只出**通用题**

只出「换个岗位也会问」的题：自我介绍、经历深挖、项目里的具体决策、
协作与冲突、动机与规划、简历上的追问。这些问的是**这个人**。

**不要出绑定具体业务域的题**——不要问 AI 搜索怎么做、导购指标怎么定，
那些留给岗位专属的那一轮。

scope 全部填 universal。`;

const DOMAIN_TAIL = `

## 这一轮只出**这个岗位专属的题**

只出「换个方向就不问了」的题：这个业务域的专门知识、
这份 JD 里点名的技术栈和场景、各家 JD 的差异点。

**不要出通用题**——自我介绍、讲个项目、你的缺点、为什么跳槽，
这些已经在通用题库里了，这一轮重复出就是浪费。

如果候选人在这个业务域上有明显缺口，要问「你没做过 X，但做过 Y，
你觉得能迁移吗」——看他有没有想过这件事。

scope 全部填 domain。`;

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "面试官会怎么问，用第二人称" },
          kind: {
            type: "string",
            enum: ["behavioral", "technical", "case", "resume", "other"],
          },
          scope: { type: "string", enum: ["universal", "domain"] },
          rationale: { type: "string", description: "面试官口吻的「我为什么问这题」" },
          cluster: { type: "string", description: "同类问题的簇名，英文小写下划线" },
          follows: {
            type: ["integer", "null"],
            description: "这是对哪道题的追问，填那道题在本数组里的下标；主问题填 null",
          },
          source: {
            type: "string",
            enum: ["role", "material", "inbox"],
          },
        },
        required: ["text", "kind", "scope", "rationale", "cluster", "follows", "source"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export type GenMode = "universal" | "domain";

export interface QuestionInputs {
  mode: GenMode;
  /** 通用题这一轮不绑岗位，传 null */
  role: null | {
    title: string;
    kind: string;
    domain: string | null;
    responsibilities: string[];
    requirements: string[];
    niceToHave: string[];
    keywords: string[];
    /** 各家 JD 的差异点，面试会针对性追问 */
    variance: string[];
  };
  /** 给原文，不只给标题——不给细节就问不出细节 */
  experiences: { title: string; summary: string; detail: string; tags: string[] }[];
  /** 面经里这个方向真被问过的题，作为出题的参照 */
  wildQuestions: string[];
}

export type GeneratedQuestion = Omit<NewQuestion, "roleId"> & { follows: number | null };

export async function generateQuestions(
  inputs: QuestionInputs
): Promise<GeneratedQuestion[]> {
  const roleBlock = inputs.role === null
    ? "（这一轮不针对具体岗位，出的是跨岗位通用的题）"
    : [
    `岗位：${inputs.role.title}`,
    inputs.role.kind === "domain"
      ? `业务域：${inputs.role.domain}（这个域的专门知识是考察重点）`
      : "类型：通用型，不绑定具体业务域",
    `职责：${inputs.role.responsibilities.join("；")}`,
    `硬性要求：${inputs.role.requirements.join("；")}`,
    `加分项：${inputs.role.niceToHave.join("；") || "（无）"}`,
    `关键词：${inputs.role.keywords.join("、")}`,
    inputs.role.variance.length > 0
      ? `\n各家 JD 的差异点（这些是会被针对性追问的）：\n${inputs.role.variance
          .map((v) => `- ${v}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 经历给原文。之前只给标题摘要，模型没有细节可抓，
  // 就只能问「讲讲你的 XX 项目」这种谁都能问的题
  const expBlock = inputs.experiences
    .map(
      (e, i) =>
        `### [${i + 1}] ${e.title}\n${e.summary}\n标签：${e.tags.join("、")}\n\n${e.detail.slice(0, 1500)}`
    )
    .join("\n\n");

  const wildBlock =
    inputs.wildQuestions.length > 0
      ? `这个方向的面经里，别人真被问过这些题（参照，不要照抄）：\n${inputs.wildQuestions
          .slice(0, 40)
          .map((q) => `- ${q}`)
          .join("\n")}`
      : "（暂无面经参照）";

  const { object } = await callLLMObject<{
    questions: {
      text: string;
      kind: string;
      scope: string;
      rationale: string;
      cluster: string;
      follows: number | null;
      source: string;
    }[];
  }>(
    "generate",
    `## 岗位画像\n${roleBlock}\n\n## 候选人经历库\n${expBlock}\n\n## 外部情报\n${wildBlock}`,
    SCHEMA,
    {
      system: SYSTEM + (inputs.mode === "universal" ? UNIVERSAL_TAIL : DOMAIN_TAIL),
      maxOutputTokens: 16000,
    }
  );

  const KINDS = ["behavioral", "technical", "case", "resume", "other"] as const;
  const SOURCES = ["role", "material", "inbox", "manual"] as const;

  // follows 是原始下标，过滤空条目后会整体偏移，先记住原位再翻译
  const raw = (object.questions ?? []).map((q, originalIndex) => ({
    originalIndex,
    text: (q.text ?? "").trim(),
    kind: (KINDS.includes(q.kind as (typeof KINDS)[number])
      ? q.kind
      : "other") as (typeof KINDS)[number],
    // scope 由这一轮的模式定死，不看模型填了什么——
    // 通用轮里冒出来的 domain 题是跑题了，不是新发现
    scope: inputs.mode,
    rationale: (q.rationale ?? "").trim() || null,
    clusterId: (q.cluster ?? "").trim() || null,
    source: (SOURCES.includes(q.source as (typeof SOURCES)[number])
      ? q.source
      : "role") as (typeof SOURCES)[number],
    rawFollows:
      typeof q.follows === "number" && q.follows >= 0 && q.follows < originalIndex
        ? q.follows
        : null,
  }));

  const kept = raw.filter((q) => q.text);
  const originalToKept = new Map<number, number>();
  kept.forEach((q, i) => originalToKept.set(q.originalIndex, i));

  return kept.map(({ originalIndex: _o, rawFollows, ...row }) => ({
    ...row,
    follows: rawFollows !== null ? (originalToKept.get(rawFollows) ?? null) : null,
  }));
}
