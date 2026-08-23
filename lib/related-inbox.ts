import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems, insights, questions } from "@/lib/db/schema";

/**
 * 练某道题时，把面经里的同类题和别人的答法调出来。
 *
 * 这是 inbox 和 studio 打通的那条线：光把面经题灌进题库不算打通，
 * 得在真正开口答之前，让人看到「这题谁被问过、他当时怎么答的、原文在哪」。
 * 否则面经就只是躺在库里的数据。
 */
export interface RelatedReference {
  questionId: number;
  questionText: string;
  /** 别人的答法，没有就是 null——面经里很多题本来就没给答案 */
  approach: { title: string; content: string; evidence: string | null } | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
}

const STOP = /[\s，。？?、,.:：；;""''「」（）()的了吗呢吧啊你我他它]/g;
const strip = (t: string) => t.replace(STOP, "");

/** 两串中文的粗糙重合度：按 2-gram 算 Jaccard */
function overlap(a: string, b: string): number {
  const grams = (t: string) => {
    const s = strip(t);
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return hit / (ga.size + gb.size - hit);
}

export function findRelatedInbox(
  target: { id: number; text: string; clusterId: string | null; topic: string | null },
  limit = 3
): RelatedReference[] {
  // 先按 cluster 和二级分类圈一个候选集，再用文本重合度排。
  // 全表算重合度也能跑（题就一百多道），但 cluster 命中的准得多
  const candidates = db
    .select({
      id: questions.id,
      text: questions.text,
      clusterId: questions.clusterId,
      topic: questions.topic,
      inboxItemId: questions.inboxItemId,
    })
    .from(questions)
    .where(
      and(
        eq(questions.source, "inbox"),
        isNull(questions.mergedInto),
        ne(questions.id, target.id),
        target.clusterId || target.topic
          ? or(
              target.clusterId ? eq(questions.clusterId, target.clusterId) : undefined,
              target.topic ? eq(questions.topic, target.topic) : undefined
            )
          : undefined
      )
    )
    .all();

  const scored = candidates
    .map((c) => ({
      c,
      score:
        overlap(target.text, c.text) +
        // 同 cluster 直接加权：那是模型判过的同类题
        (target.clusterId && c.clusterId === target.clusterId ? 0.35 : 0),
    }))
    .filter((x) => x.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return [];

  const out: RelatedReference[] = [];
  for (const { c } of scored) {
    const approachRow = db
      .select({
        title: insights.title,
        content: insights.content,
        evidence: insights.evidence,
      })
      .from(insights)
      .where(and(eq(insights.questionId, c.id), isNull(insights.mergedInto)))
      .get();

    const source = c.inboxItemId
      ? db
          .select({ title: inboxItems.title, url: inboxItems.sourceUrl })
          .from(inboxItems)
          .where(eq(inboxItems.id, c.inboxItemId))
          .get()
      : undefined;

    out.push({
      questionId: c.id,
      questionText: c.text,
      approach: approachRow
        ? {
            title: approachRow.title,
            content: approachRow.content,
            evidence: approachRow.evidence,
          }
        : null,
      sourceTitle: source?.title ?? null,
      sourceUrl: source?.url ?? null,
    });
  }
  return out;
}
