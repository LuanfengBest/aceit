import { callLLMObject } from "@/lib/llm";
import type { NewQuestion } from "@/lib/db/schema";

const SYSTEM = `你是资深面试官，为候选人准备一场针对具体岗位的面试。

给你三样东西：
1. 岗位画像（职责、硬性要求、加分项、关键词）
2. 候选人的经历库（每条是他做过的一件事）
3. 外部情报（别人分享的面经，可能为空）

出题要求：
- 出这个岗位**真的会问**的题，不是通用题库。每道题都要能对应到岗位的某条要求或候选人简历里的某个点。
- 覆盖四类：behavioral（行为/经历追问）、technical（专业能力）、case（情景/假设）、resume（简历本身的追问，比如空窗、跳槽、某个数字怎么来的）。
- 优先出那些候选人**答不好会掉分**的题：岗位要求里他经历较薄的地方、简历上容易被追问的地方。
- 如果外部情报里提到了具体被问过的问题，优先收进来，并在 rationale 里注明来自面经。
- rationale 写清楚"为什么会问这题"，一句话。
- cluster 用于把措辞不同、本质相同的题归到一起（比如"讲个跨部门协作的例子"和"你怎么推动别人配合你"是同一簇）。用简短的英文小写下划线命名，如 cross_team_influence。

出 12-18 题。`;

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
          rationale: { type: "string", description: "为什么会问这题，一句话" },
          cluster: { type: "string", description: "同类问题的簇名，英文小写下划线" },
          source: {
            type: "string",
            enum: ["role", "material", "inbox"],
            description: "这题主要由岗位要求、候选人经历、还是外部情报驱动",
          },
        },
        required: ["text", "kind", "rationale", "cluster", "source"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

export interface QuestionInputs {
  role: {
    title: string;
    company: string | null;
    responsibilities: string[];
    requirements: string[];
    niceToHave: string[];
    keywords: string[];
  };
  experiences: { title: string; summary: string; tags: string[] }[];
  signals: { title: string; desc: string }[];
}

export async function generateQuestions(
  inputs: QuestionInputs
): Promise<Omit<NewQuestion, "roleId">[]> {
  const roleBlock = [
    `岗位：${inputs.role.title}${inputs.role.company ? ` @ ${inputs.role.company}` : ""}`,
    `职责：${inputs.role.responsibilities.join("；")}`,
    `硬性要求：${inputs.role.requirements.join("；")}`,
    `加分项：${inputs.role.niceToHave.join("；") || "（无）"}`,
    `关键词：${inputs.role.keywords.join("、")}`,
  ].join("\n");

  const expBlock = inputs.experiences
    .map((e, i) => `[${i + 1}] ${e.title} — ${e.summary}（标签：${e.tags.join("、")}）`)
    .join("\n");

  const signalBlock =
    inputs.signals.length > 0
      ? inputs.signals.map((s) => `- ${s.title}：${s.desc.slice(0, 300)}`).join("\n")
      : "（暂无）";

  const { object } = await callLLMObject<{
    questions: {
      text: string;
      kind: string;
      rationale: string;
      cluster: string;
      source: string;
    }[];
  }>(
    "generate",
    `## 岗位画像\n${roleBlock}\n\n## 候选人经历库\n${expBlock}\n\n## 外部情报\n${signalBlock}`,
    SCHEMA,
    { system: SYSTEM, maxOutputTokens: 8000 }
  );

  const KINDS = ["behavioral", "technical", "case", "resume", "other"] as const;
  const SOURCES = ["role", "material", "inbox", "manual"] as const;

  return (object.questions ?? [])
    .map((q) => ({
      text: (q.text ?? "").trim(),
      kind: (KINDS.includes(q.kind as (typeof KINDS)[number])
        ? q.kind
        : "other") as (typeof KINDS)[number],
      rationale: (q.rationale ?? "").trim() || null,
      clusterId: (q.cluster ?? "").trim() || null,
      source: (SOURCES.includes(q.source as (typeof SOURCES)[number])
        ? q.source
        : "role") as (typeof SOURCES)[number],
    }))
    .filter((q) => q.text);
}
