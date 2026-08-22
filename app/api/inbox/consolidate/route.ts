import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights, questions } from "@/lib/db/schema";
import { consolidateInsights, findDuplicateQuestions } from "@/lib/consolidate-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 把散落的知识条目去重 + 归主题，同时给面经题去重 */
export async function POST() {
  const live = db.select().from(insights).where(isNull(insights.mergedInto)).all();

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

    return NextResponse.json({
      insights: live.length,
      merged: mergedCount,
      topics: topicCount,
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
