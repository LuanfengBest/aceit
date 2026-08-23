import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { interviewQas, questions, recordings } from "@/lib/db/schema";
import { matchInterview } from "@/lib/match-interview";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Params = { params: Promise<{ id: string }> };

/**
 * 把一段转写拆成「被问到的题 + 我怎么答的」，和题库对一遍。
 *
 * 闭环就在这一步：真实面试里被问到、但题库里没有的题，
 * 直接补进题库（source=interview），下一轮准备就有它了。
 * 这也是 interview_qas 必须外键关联回 questions 的原因——
 * 没有这个外键，复盘就只是记流水账。
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  const rec = db.select().from(recordings).where(eq(recordings.id, id)).get();
  if (!rec) return NextResponse.json({ error: "录音不存在" }, { status: 404 });
  if (!rec.transcript?.trim()) {
    return NextResponse.json({ error: "还没转写" }, { status: 400 });
  }

  // 重跑时先清掉上一轮的结果，不然会重复堆积
  db.delete(interviewQas).where(eq(interviewQas.recordingId, id)).run();

  const bank = db
    .select({ id: questions.id, text: questions.text })
    .from(questions)
    .where(and(isNull(questions.mergedInto), isNull(questions.parentId)))
    .all();

  try {
    const result = await matchInterview(rec.transcript, bank);
    if (result.items.length === 0) {
      return NextResponse.json({ error: "没能从转写里读出问题" }, { status: 502 });
    }

    let added = 0;
    for (const item of result.items) {
      let questionId = item.matchedQuestionId;

      // 题库里没有 → 补进去。这是闭环的那一步：
      // 真实面试问到的题，下一轮准备就能练到
      if (questionId === null && item.askedText.trim().length > 5) {
        const inserted = db
          .insert(questions)
          .values({
            text: item.askedText.trim(),
            kind: "other",
            source: "interview",
            roleId: rec.roleId,
            rationale: rec.company
              ? `${rec.company}${rec.round ? ` ${rec.round}` : ""}真的问过`
              : "真实面试里问过",
          })
          .run();
        questionId = Number(inserted.lastInsertRowid);
        added++;
      }

      db.insert(interviewQas)
        .values({
          recordingId: id,
          questionId,
          roleId: rec.roleId,
          company: rec.company ?? result.company ?? null,
          round: rec.round ?? result.round ?? null,
          askedText: item.askedText,
          myAnswer: item.myAnswer || null,
          reflection: item.reflection || null,
          interviewedAt: rec.interviewedAt,
        })
        .run();
    }

    db.update(recordings).set({ status: "debriefed" }).where(eq(recordings.id, id)).run();

    return NextResponse.json({
      id,
      asked: result.items.length,
      matched: result.items.length - added,
      newToTheBank: added,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `复盘失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
