import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, questions, experiences, roleProfiles } from "@/lib/db/schema";
import { refineAnswer } from "@/lib/generate-answer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** 在某一版答案上打磨，产出新版本，旧版保留 */
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  let body: { instruction?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    return NextResponse.json({ error: "说清楚要怎么改" }, { status: 400 });
  }

  const base = db.select().from(answers).where(eq(answers.id, id)).get();
  if (!base) return NextResponse.json({ error: "答案不存在" }, { status: 404 });

  const question = db
    .select()
    .from(questions)
    .where(eq(questions.id, base.questionId))
    .get();
  if (!question) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  const role = question.roleId
    ? db.select().from(roleProfiles).where(eq(roleProfiles.id, question.roleId)).get()
    : null;

  const exps = db.select().from(experiences).all();

  try {
    const result = await refineAnswer(
      question.text,
      role?.title ?? "目标岗位",
      base.content,
      instruction,
      exps.map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        detail: e.detail,
      }))
    );

    const latest = db
      .select({ version: answers.version })
      .from(answers)
      .where(eq(answers.questionId, base.questionId))
      .orderBy(desc(answers.version))
      .get();

    const created = db
      .insert(answers)
      .values({
        questionId: base.questionId,
        content: result.content,
        version: (latest?.version ?? base.version) + 1,
        parentId: base.id,
        note: instruction,
        usedExperienceIds: JSON.stringify(result.usedExperienceIds),
      })
      .returning()
      .get();

    return NextResponse.json({ ...created, gaps: result.gaps }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: `打磨失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
