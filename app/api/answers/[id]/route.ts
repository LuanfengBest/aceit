import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 把某一版标成定稿。版本链全留着，只是换一下哪版是要用的那版 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const target = db.select().from(answers).where(eq(answers.id, id)).get();
  if (!target) return NextResponse.json({ error: "这版答案不存在" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  const status = body.status === "keeper" ? "keeper" : body.status === "draft" ? "draft" : null;
  if (!status) {
    return NextResponse.json({ error: "status 只能是 keeper 或 draft" }, { status: 400 });
  }

  if (status === "keeper") {
    // 一道题同时只有一版是定稿
    db.update(answers)
      .set({ status: "draft" })
      .where(and(eq(answers.questionId, target.questionId), ne(answers.id, id)))
      .run();
  }
  db.update(answers).set({ status }).where(eq(answers.id, id)).run();

  return NextResponse.json({ id, status });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  db.delete(answers).where(eq(answers.id, id)).run();
  return NextResponse.json({ deleted: 1 });
}
