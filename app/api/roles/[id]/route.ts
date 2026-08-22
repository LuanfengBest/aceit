import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { roleProfiles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const deleted = db
    .delete(roleProfiles)
    .where(eq(roleProfiles.id, id))
    .returning({ id: roleProfiles.id })
    .get();
  if (!deleted) {
    return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
  }
  return NextResponse.json(deleted);
}
