import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights, questions } from "@/lib/db/schema";
import {
  assignQuestionTopics,
  consolidateInsights,
  findDuplicateQuestions,
  mergeTopics,
} from "@/lib/consolidate-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 把散落的知识条目去重 + 归主题，同时给面经题去重 */
export async function POST() {
  // 只整理通用知识。挂在题上的答法各自服务于不同的题，
  // 内容看着像但不能合并——合并了就把"这条答法对应哪道题"弄丢了
  const live = db
    .select()
    .from(insights)
    .where(and(isNull(insights.mergedInto), isNull(insights.questionId)))
    .all();

  const existingTopics = [
    ...new Set(live.map((i) => i.topic).filter((t): t is string => !!t)),
  ];

  let mergedCount = 0;
  let topicCount = 0;

  try {
    if (live.length > 0) {
      const assignments = await consolidateInsights(
        live.map((i) => ({
          id: i.id,
          kind: i.kind,
          title: i.title,
          content: i.content,
        })),
        existingTopics
      );

      for (const a of assignments) {
        db.update(insights)
          .set({ topic: a.topic, mergedInto: a.duplicateOf })
          .where(eq(insights.id, a.id))
          .run();
        if (a.duplicateOf) mergedCount++;
      }
      topicCount = new Set(assignments.map((a) => a.topic)).size;
    }

    // 面经题去重
    const inboxQs = db
      .select({ id: questions.id, text: questions.text })
      .from(questions)
      .where(
        and(
          eq(questions.source, "inbox"),
          isNull(questions.roleId),
          isNull(questions.mergedInto)
        )
      )
      .all();

    const dupes = await findDuplicateQuestions(inboxQs);
    for (const d of dupes) {
      // 标记而不删除：判错了还能捞回来
      db.update(questions)
        .set({ mergedInto: d.keep })
        .where(eq(questions.id, d.id))
        .run();
    }

    // 主题攒多了就压一轮，避免越消化越碎
    const afterAssign = [
      ...new Set(
        db
          .select({ topic: insights.topic })
          .from(insights)
          .where(and(isNull(insights.mergedInto), isNull(insights.questionId)))
          .all()
          .map((r) => r.topic)
          .filter((t): t is string => !!t)
      ),
    ];
    const cap = Math.max(4, Math.min(8, Math.ceil(live.length / 4)));
    const remap = await mergeTopics(afterAssign, cap);
    for (const [from, to] of remap) {
      db.update(insights).set({ topic: to }).where(eq(insights.topic, from)).run();
      db.update(questions).set({ topic: to }).where(eq(questions.topic, from)).run();
    }

    // 题也归主题，复用刚才 insights 定下来的主题名
    const topicsAfter = [
      ...new Set(
        db
          .select({ topic: insights.topic })
          .from(insights)
          .where(and(isNull(insights.mergedInto), isNull(insights.questionId)))
          .all()
          .map((r) => r.topic)
          .filter((t): t is string => !!t)
      ),
    ];
    const merged = new Set(dupes.map((d) => d.id));

    // 只给主问题分主题：追问必须跟父级同组，否则渲染时会跟主问题拆散
    const allInbox = db
      .select({ id: questions.id, text: questions.text, parentId: questions.parentId })
      .from(questions)
      .where(and(eq(questions.source, "inbox"), isNull(questions.mergedInto)))
      .all();

    const mains = allInbox.filter((q) => q.parentId === null && !merged.has(q.id));
    const qTopics = await assignQuestionTopics(
      mains.map((q) => ({ id: q.id, text: q.text })),
      topicsAfter
    );

    const topicById = new Map(qTopics.map((a) => [a.id, a.topic]));
    for (const a of qTopics) {
      db.update(questions).set({ topic: a.topic }).where(eq(questions.id, a.id)).run();
    }
    // 追问继承父级主题
    for (const q of allInbox) {
      if (q.parentId === null) continue;
      const inherited = topicById.get(q.parentId);
      if (inherited) {
        db.update(questions).set({ topic: inherited }).where(eq(questions.id, q.id)).run();
      }
    }

    return NextResponse.json({
      insights: live.length,
      merged: mergedCount,
      topics: topicCount,
      topicsMerged: remap.size,
      questionsBefore: inboxQs.length,
      questionsMerged: dupes.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `整理失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
