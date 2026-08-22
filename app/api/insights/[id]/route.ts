import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 改一条知识的位置。
 * question_id 传 null 就从题上摘下来放回 playbook，
 * 传题的 id 就挂到那道题上（分类跟着那道题走，在前端算好传过来）。
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const target = db.select().from(insights).where(eq(insights.id, id)).get();
  if (!target) {
    return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    kind?: unknown;
    topic_l1?: unknown;
    topic?: unknown;
  };

  const KINDS = ["approach", "company", "term", "pitfall"] as const;
  const patch: Record<string, unknown> = {};
  if (typeof body.kind === "string" && KINDS.includes(body.kind as (typeof KINDS)[number])) {
    patch.kind = body.kind;
  }
  if (typeof body.topic_l1 === "string" && body.topic_l1.trim()) {
    patch.topicL1 = body.topic_l1.trim();
  }
  if (typeof body.topic === "string" && body.topic.trim()) {
    patch.topic = body.topic.trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "没有要改的字段" }, { status: 400 });
  }

  db.update(insights).set(patch).where(eq(insights.id, id)).run();
  return NextResponse.json({ id, ...patch });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const target = db.select().from(insights).where(eq(insights.id, id)).get();
  if (!target) {
    return NextResponse.json({ error: "条目不存在" }, { status: 404 });
  }
  db.delete(insights).where(eq(insights.id, id)).run();
  return NextResponse.json({ deleted: 1 });
}
