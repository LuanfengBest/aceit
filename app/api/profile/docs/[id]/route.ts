import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileDocs, experiences } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 删一份文档，连同它拆出来的所有片段 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  const frags = db
    .select({ id: experiences.id })
    .from(experiences)
    .where(eq(experiences.docId, id))
    .all().length;

  const deleted = db
    .delete(profileDocs)
    .where(eq(profileDocs.id, id))
    .returning({ id: profileDocs.id, filename: profileDocs.filename })
    .get();

  if (!deleted) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ ...deleted, deletedExperiences: frags });
}
