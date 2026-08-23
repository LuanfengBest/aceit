import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { experiences, questions } from "@/lib/db/schema";
import { linkExperiences } from "@/lib/link-experiences";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * 把题关联到经历。
 * 默认只补还没关联过的（增量）；all=true 时全部重跑。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { all?: unknown };
  const redoAll = body.all === true;

  const exps = db
    .select({ id: experiences.id, title: experiences.title, summary: experiences.summary })
    .from(experiences)
    .all();
  if (exps.length === 0) {
    return NextResponse.json({ error: "经历库是空的" }, { status: 400 });
  }

  const all = db
    .select({
      id: questions.id,
      text: questions.text,
      experienceIds: questions.experienceIds,
    })
    .from(questions)
    .where(and(isNull(questions.mergedInto), isNull(questions.parentId)))
    .all();

  const todo = redoAll
    ? all
    : all.filter((q) => {
        try {
          return (JSON.parse(q.experienceIds || "[]") as number[]).length === 0;
        } catch {
          return true;
        }
      });

  if (todo.length === 0) {
    return NextResponse.json({ checked: 0, linked: 0, note: "都关联过了" });
  }

  try {
    const links = await linkExperiences(
      todo.map((q) => ({ id: q.id, text: q.text })),
      exps.map((e) => ({ id: e.id, title: e.title, summary: e.summary ?? "" }))
    );

    let linked = 0;
    for (const l of links) {
      db.update(questions)
        .set({ experienceIds: JSON.stringify(l.experienceIds) })
        .where(eq(questions.id, l.id))
        .run();
      if (l.experienceIds.length > 0) linked++;
    }

    // 追问跟着主问题走：它挖的是同一段经历
    for (const l of links) {
      db.update(questions)
        .set({ experienceIds: JSON.stringify(l.experienceIds) })
        .where(eq(questions.parentId, l.id))
        .run();
    }

    return NextResponse.json({ checked: todo.length, linked });
  } catch (err) {
    return NextResponse.json(
      { error: `关联失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
