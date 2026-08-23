import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { roleJds, roleProfiles } from "@/lib/db/schema";
import { routeJd, shapeRole } from "@/lib/aggregate-roles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 贴一份 JD。
 * 不再是一份 JD 一个画像——先判断该并进哪个已有画像，
 * 再把那一组 JD 重新提炼一遍。四份 AI 产品经理的 JD 最后是一个画像，
 * 底下挂四份原文。
 */
export async function POST(req: NextRequest) {
  let body: { jd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const rawJd = typeof body.jd === "string" ? body.jd.trim() : "";
  if (rawJd.length < 30) {
    return NextResponse.json({ error: "JD 太短了，粘完整一点" }, { status: 400 });
  }

  try {
    const existing = db
      .select({
        id: roleProfiles.id,
        title: roleProfiles.title,
        kind: roleProfiles.kind,
        domain: roleProfiles.domain,
      })
      .from(roleProfiles)
      .all();

    const verdict = await routeJd(rawJd, existing);

    let roleId = verdict.mergeInto;
    if (roleId === null) {
      // 先占个位，画像内容下面统一提炼
      roleId = Number(
        db
          .insert(roleProfiles)
          .values({
            title: verdict.title,
            company: verdict.company || null,
            rawJd,
            kind: verdict.kind,
            domain: verdict.domain,
          })
          .run().lastInsertRowid
      );
    }

    db.insert(roleJds)
      .values({
        roleId,
        company: verdict.company || null,
        title: verdict.title,
        rawJd,
      })
      .run();

    const group = db
      .select({
        company: roleJds.company,
        title: roleJds.title,
        rawJd: roleJds.rawJd,
      })
      .from(roleJds)
      .where(eq(roleJds.roleId, roleId))
      .all();

    const shape = await shapeRole(group, verdict.kind, verdict.domain);

    db.update(roleProfiles)
      .set({
        title: shape.title,
        responsibilities: JSON.stringify(shape.responsibilities),
        requirements: JSON.stringify(shape.requirements),
        niceToHave: JSON.stringify(shape.niceToHave),
        keywords: JSON.stringify(shape.keywords),
        topics: JSON.stringify(shape.topics),
        variance: JSON.stringify(shape.variance),
        kind: verdict.kind,
        domain: verdict.domain,
        // 多份 JD 之后 company 就没意义了，画像归画像
        company: group.length > 1 ? null : verdict.company || null,
      })
      .where(eq(roleProfiles.id, roleId))
      .run();

    const updated = db
      .select()
      .from(roleProfiles)
      .where(eq(roleProfiles.id, roleId))
      .get();

    return NextResponse.json(
      {
        ...updated,
        jdCount: group.length,
        merged: verdict.mergeInto !== null,
        reason: verdict.reason,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `处理失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
