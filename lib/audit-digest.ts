import { callLLMObject } from "@/lib/llm";
import type { SourceUnit, UnitResult } from "@/lib/digest-unit";

/**
 * 抽完之后回头核一遍：这个单元里的信息，是不是不多不少地都在结果里。
 *
 * 抽取和核对分开做是有意的——让同一次调用「一边抄一边保证自己没抄错」
 * 是不成立的，它不会承认自己漏了。核对这一趟只有一个任务：挑毛病。
 */
export interface AuditFinding {
  /** 哪个单元 */
  unit: string;
  /** missing：片段里有但没抽出来；unsupported：抽出来了但片段里找不到 */
  type: "missing" | "unsupported";
  /** question / answer / insight */
  of: string;
  detail: string;
}

const SYSTEM = `你在检查一次信息提取的结果，看有没有**漏抽**或**多抽**。

给你两样东西：一个素材片段，和从这个片段里抽出来的结果。
你的任务是挑毛病，不是复述结果。

两类问题：

1. missing —— 片段里有，但结果里没有
   - 片段里出现了某道面试题，questions 里没有
   - 片段里写了某道题怎么答，那道题的 answer 却是 null
   - 片段里有值得留的通用知识（公司情况、术语解释、踩坑），insights 里没有
   detail 里写清楚漏了什么，把片段里的原话带上。

2. unsupported —— 结果里有，但片段里找不到
   - 某道题片段里根本没出现
   - 某个答法片段里没写，是凭空生成的
   - 某条知识片段里没有依据
   detail 里写清楚哪一条、以及为什么片段里支撑不了它。

判断从严，但不要吹毛求疵：
- 措辞不同、精简了、换了说法，**不算问题**。只看信息本身在不在。
- 结果里的答法比片段里写得更有条理，只要内容没超出片段，**不算 unsupported**。
- 片段里明明只有题目没有答案，结果里 answer 全是 null，**这是对的，不要报 missing**。

没有问题就返回空数组。别为了显得认真而硬找。`;

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["missing", "unsupported"] },
          of: { type: "string", enum: ["question", "answer", "insight"] },
          detail: { type: "string", description: "具体是什么，带上片段里的原话" },
        },
        required: ["type", "of", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
} as const;

function renderResult(result: UnitResult): string {
  const qs = result.questions.length
    ? result.questions
        .map(
          (q, i) =>
            `${i + 1}. ${q.text}\n   答法：${q.answer ? q.answer.content : "（null，没抽到）"}`
        )
        .join("\n")
    : "（没抽到题）";
  const is = result.insights.length
    ? result.insights.map((i) => `- [${i.kind}] ${i.title}：${i.content}`).join("\n")
    : "（没抽到通用知识）";
  return `## 抽出来的题\n${qs}\n\n## 抽出来的通用知识\n${is}`;
}

export async function auditUnit(
  unit: SourceUnit,
  result: UnitResult,
  noteTitle: string | null
): Promise<AuditFinding[]> {
  // 片段空、结果也空，没什么可核的
  if (
    unit.kind === "text" &&
    (unit.lines ?? []).join("").trim() === "" &&
    result.questions.length === 0
  ) {
    return [];
  }

  const header = noteTitle ? `素材标题：${noteTitle}\n\n` : "";
  const fragment =
    unit.kind === "text"
      ? `## 素材片段（${unit.label}）\n${(unit.lines ?? []).join("\n")}`
      : `## 素材片段：${unit.label}（就是附的这张图）`;

  try {
    const { object } = await callLLMObject<{
      findings: { type: string; of: string; detail: string }[];
    }>(
      unit.kind === "image" ? "extract_image" : "extract",
      `${header}${fragment}\n\n${renderResult(result)}`,
      SCHEMA,
      {
        system: SYSTEM,
        images: unit.image ? [unit.image] : undefined,
        maxOutputTokens: 4000,
      }
    );

    return (object.findings ?? [])
      .filter((f) => (f.detail ?? "").trim())
      .map((f) => ({
        unit: unit.label,
        type: f.type === "unsupported" ? ("unsupported" as const) : ("missing" as const),
        of: f.of ?? "question",
        detail: f.detail.trim(),
      }));
  } catch {
    // 核对本身挂了不影响抽取结果，只是这一单元没核到
    return [];
  }
}
