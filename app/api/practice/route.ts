import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, experiences, questions } from "@/lib/db/schema";
import { critiqueAnswer } from "@/lib/practice";
import { findRelatedInbox } from "@/lib/related-inbox";
import { pickExperiences } from "@/lib/generate-answer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 一轮语音陪练：收下口头回答 → 评点 → 存成新版本。
 * 版本链不覆盖，每一轮都留着，方便回看「上一版其实更好」。
 */
export async function POST(req: NextRequest) {
  let body: { question_id?: unknown; transcript?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const questionId = Number(body.question_id);
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return NextResponse.json({ error: "无效的 question_id" }, { status: 400 });
  }
  if (transcript.length < 4) {
    return NextResponse.json({ error: "没听到内容，再说一遍" }, { status: 400 });
  }

  const question = db.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!question) {
    return NextResponse.json({ error: "题不存在" }, { status: 404 });
  }

  const allExp = db.select().from(experiences).all();

  try {
    // 先选材再评：全量塞进去会把输出挤没，这个坑之前踩过
    const picked = allExp.length > 0 ? await pickExperiences(question.text, allExp) : [];

    const related = findRelatedInbox({
      id: question.id,
      text: question.text,
      clusterId: question.clusterId,
      topic: question.topic,
    });

    const critique = await critiqueAnswer({
      question: question.text,
      transcript,
      experiences: picked.map((e) => ({
        title: e.title,
        summary: e.summary ?? "",
        detail: e.detail ?? "",
      })),
      reference: related
        .filter((r) => r.approach)
        .map((r) => ({
          title: r.approach!.title,
          content: r.approach!.content,
          source: r.sourceTitle ?? "面经",
        })),
    });

    // 存版本：口语原话和打磨后的书面版都留着
    const prev = db
      .select()
      .from(answers)
      .where(eq(answers.questionId, questionId))
      .orderBy(desc(answers.version))
      .get();

    const inserted = db
      .insert(answers)
      .values({
        questionId,
        content: critique.polished || transcript,
        version: (prev?.version ?? 0) + 1,
        parentId: prev?.id ?? null,
        note: critique.nextStep || "语音陪练",
        usedExperienceIds: JSON.stringify(picked.map((e) => e.id)),
        spokenTranscript: transcript,
        status: "draft",
      })
      .run();

    return NextResponse.json({
      answerId: Number(inserted.lastInsertRowid),
      version: (prev?.version ?? 0) + 1,
      critique,
      usedExperiences: picked.map((e) => ({ id: e.id, title: e.title })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `评点失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
