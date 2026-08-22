import { callLLMObject } from "@/lib/llm";

export interface Candidate {
  title: string;
  summary: string;
  detail: string;
  tags: string[];
}

export interface ExistingBrief {
  id: number;
  title: string;
  summary: string;
}

/** 每条候选的归属：并进已有片段、并进前面的某条候选、或独立成条 */
export interface Verdict {
  mergeIntoExistingId: number | null;
  mergeIntoCandidateIndex: number | null;
}

const SYSTEM = `你在给一批「经历片段」做去重归并。

同一件事常常被写到多份文档里——简历里是一句话，经历长文里是三千字详述；或者同一个项目在文档不同位置被提到两次。它们应该是同一条经历，不是两条。

判断标准：说的是不是**同一件事**（同一个项目、同一次攻坚）。
- 措辞不同不影响判断：「渠道归因体系设计」和「多渠道归因体系建设与口径标准化」是同一件事。
- 详略不同也不影响：一句话概括和详细叙述可以是同一件事。
- 但下面这些**不是**同一件事，不要合并：
  - 同一家公司下的不同项目（都在美团不代表是一件事）
  - 同一个大项目下的不同模块（「知识库建设」和「问答Agent」是两件事，不要因为都属于同一个引擎就合并）

对每条候选给出判断：
- merge_into_existing_id：如果它和某条【已有片段】是同一件事，填那条的 id，否则 null
- merge_into_candidate_index：如果它和前面某条【候选】是同一件事，填那条的序号（必须小于自己的序号），否则 null
- 两个都为 null 表示它是一条新的独立经历
- 优先合并到已有片段`;

const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "候选的序号" },
          merge_into_existing_id: { type: ["integer", "null"] },
          merge_into_candidate_index: { type: ["integer", "null"] },
        },
        required: ["index", "merge_into_existing_id", "merge_into_candidate_index"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

/**
 * 判断每条候选该并到哪里。只做判断，不改数据——调用方负责落库。
 * 候选为空或没有任何可比对象时直接返回“各自独立”。
 */
export async function judgeMerges(
  candidates: Candidate[],
  existing: ExistingBrief[]
): Promise<Verdict[]> {
  const independent: Verdict[] = candidates.map(() => ({
    mergeIntoExistingId: null,
    mergeIntoCandidateIndex: null,
  }));

  if (candidates.length === 0) return independent;
  if (candidates.length === 1 && existing.length === 0) return independent;

  const existingBlock =
    existing.length > 0
      ? `已有片段：\n${existing
          .map((e) => `[id=${e.id}] ${e.title} —— ${e.summary}`)
          .join("\n")}\n\n`
      : "（当前还没有已有片段）\n\n";

  const candidateBlock = `本次候选：\n${candidates
    .map((c, i) => `[${i}] ${c.title} —— ${c.summary}`)
    .join("\n")}`;

  const { object } = await callLLMObject<{
    verdicts: {
      index: number;
      merge_into_existing_id: number | null;
      merge_into_candidate_index: number | null;
    }[];
  }>("classify", `${existingBlock}${candidateBlock}`, SCHEMA, {
    system: SYSTEM,
    maxOutputTokens: 8000,
  });

  const existingIds = new Set(existing.map((e) => e.id));

  for (const v of object.verdicts ?? []) {
    const i = v.index;
    if (!Number.isInteger(i) || i < 0 || i >= candidates.length) continue;

    const targetId = v.merge_into_existing_id;
    if (typeof targetId === "number" && existingIds.has(targetId)) {
      independent[i].mergeIntoExistingId = targetId;
      continue;
    }

    const targetIndex = v.merge_into_candidate_index;
    // 只允许往前指，避免成环
    if (typeof targetIndex === "number" && targetIndex >= 0 && targetIndex < i) {
      independent[i].mergeIntoCandidateIndex = targetIndex;
    }
  }

  return independent;
}

/** 沿着 candidate → candidate 的指向找到最终代表，路径压缩，防环 */
export function resolveCandidateRoot(verdicts: Verdict[], index: number): number {
  const seen = new Set<number>();
  let current = index;
  while (
    verdicts[current].mergeIntoCandidateIndex !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    current = verdicts[current].mergeIntoCandidateIndex!;
  }
  return current;
}
