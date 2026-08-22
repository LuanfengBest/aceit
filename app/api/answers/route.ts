import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, questions, experiences, roleProfiles } from "@/lib/db/schema";
import { draftAnswer } from "@/lib/generate-answer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 生成某道题的首版答案 */
export async function POST(req: NextRequest) {
  let body: { questionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const questionId = Number(body.questionId);
  if (!Number.isInteger(questionId)) {
    return NextResponse.json({ error: "缺少 questionId" }, { status: 400 });
  }

  const question = db.select().from(questions).where(eq(questions.id, questionId)).get();
  if (!question) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  const role = question.roleId
    ? db.select().from(roleProfiles).where(eq(roleProfiles.id, question.roleId)).get()
    : null;

  const exps = db.select().from(experiences).all();
  if (exps.length === 0) {
    return NextResponse.json({ error: "经历库是空的" }, { status: 400 });
  }

  try {
    const result = await draftAnswer(
      question.text,
      role?.title ?? "目标岗位",
      exps.map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        detail: e.detail,
      }))
    );

    const latest = db
      .select({ version: answers.version, id: answers.id })
      .from(answers)
      .where(eq(answers.questionId, questionId))
      .orderBy(desc(answers.version))
      .get();

    const created = db
      .insert(answers)
      .values({
        questionId,
        content: result.content,
        version: (latest?.version ?? 0) + 1,
        parentId: latest?.id ?? null,
        note: latest ? "重新生成" : "初版",
        usedExperienceIds: JSON.stringify(result.usedExperienceIds),
      })
      .returning()
      .get();

    return NextResponse.json({ ...created, gaps: result.gaps }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: `生成失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
