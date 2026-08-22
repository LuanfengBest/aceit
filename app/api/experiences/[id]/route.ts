import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { experiences } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const patch: Partial<typeof experiences.$inferInsert> = {};
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.summary === "string") patch.summary = body.summary.trim();
  if (typeof body.detail === "string") patch.detail = body.detail.trim();
  if (Array.isArray(body.tags)) {
    patch.tags = JSON.stringify(
      body.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
    );
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }
  if (patch.title === "") {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  const updated = db
    .update(experiences)
    .set(patch)
    .where(eq(experiences.id, id))
    .returning()
    .get();

  if (!updated) {
    return NextResponse.json({ error: "片段不存在" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  const deleted = db
    .delete(experiences)
    .where(eq(experiences.id, id))
    .returning({ id: experiences.id })
    .get();

  if (!deleted) {
    return NextResponse.json({ error: "片段不存在" }, { status: 404 });
  }
  return NextResponse.json({ id: deleted.id });
}
