import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, questions } from "@/lib/db/schema";
import { dedupeQuestions } from "@/lib/dedupe-questions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 题库去重。只标记不删除——判错了还能捞回来，这个教训是用数据损失换的。
 * 只处理主问题：追问贴着各自的主问题，跨主问题比没有意义。
 */
export async function POST() {
  const live = db
    .select({
      id: questions.id,
      text: questions.text,
      cluster: questions.clusterId,
    })
    .from(questions)
    .where(and(isNull(questions.mergedInto), isNull(questions.parentId)))
    .all();

  if (live.length < 2) {
    return NextResponse.json({ checked: live.length, merged: 0, renamed: 0 });
  }

  const answered = new Set(
    db
      .select({ questionId: answers.questionId })
      .from(answers)
      .all()
      .map((a) => a.questionId)
  );

  try {
    const { pairs, renames } = await dedupeQuestions(
      live.map((q) => ({ ...q, hasAnswers: answered.has(q.id) }))
    );

    for (const p of pairs) {
      // 被并掉的题如果有答案，把答案迁到留下的那道上——练过的东西不能丢
      db.update(answers)
        .set({ questionId: p.keep })
        .where(eq(answers.questionId, p.id))
        .run();
      db.update(questions)
        .set({ mergedInto: p.keep })
        .where(eq(questions.id, p.id))
        .run();
      // 追问跟着改挂到留下的那道下面
      db.update(questions)
        .set({ parentId: p.keep })
        .where(eq(questions.parentId, p.id))
        .run();
    }

    for (const r of renames) {
      db.update(questions)
        .set({ clusterId: r.to })
        .where(eq(questions.clusterId, r.from))
        .run();
    }

    const mergedTexts = pairs.length
      ? db
          .select({ id: questions.id, text: questions.text })
          .from(questions)
          .where(inArray(questions.id, pairs.map((p) => p.id)))
          .all()
      : [];

    return NextResponse.json({
      checked: live.length,
      merged: pairs.length,
      renamed: renames.length,
      mergedTexts: mergedTexts.map((m) => m.text.slice(0, 40)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `去重失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
