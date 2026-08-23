import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { roleJds, roleProfiles } from "@/lib/db/schema";
import { shapeRole } from "@/lib/aggregate-roles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

/** 重新提炼这个画像（JD 没变，但提炼规则改了时用） */
export async function PATCH(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const role = db.select().from(roleProfiles).where(eq(roleProfiles.id, id)).get();
  if (!role) return NextResponse.json({ error: "岗位不存在" }, { status: 404 });

  const group = db
    .select({ company: roleJds.company, title: roleJds.title, rawJd: roleJds.rawJd })
    .from(roleJds)
    .where(eq(roleJds.roleId, id))
    .all();
  if (group.length === 0) {
    return NextResponse.json({ error: "这个画像下面没有 JD" }, { status: 400 });
  }

  try {
    const shape = await shapeRole(group, role.kind, role.domain);
    db.update(roleProfiles)
      .set({
        title: shape.title,
        responsibilities: JSON.stringify(shape.responsibilities),
        requirements: JSON.stringify(shape.requirements),
        niceToHave: JSON.stringify(shape.niceToHave),
        keywords: JSON.stringify(shape.keywords),
        topics: JSON.stringify(shape.topics),
        variance: JSON.stringify(shape.variance),
      })
      .where(eq(roleProfiles.id, id))
      .run();
    return NextResponse.json({ id, title: shape.title, topics: shape.topics, keywords: shape.keywords.length });
  } catch (err) {
    return NextResponse.json(
      { error: `重新提炼失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
