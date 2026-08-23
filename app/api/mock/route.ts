import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mockSessions, mockTurns, roleJds, roleProfiles } from "@/lib/db/schema";
import { routeJd, shapeRole } from "@/lib/aggregate-roles";
import { buildContext, nextTurn } from "@/lib/mock-interview";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 开一场模拟面试。
 * 粘了 JD 就顺手建/并入一个岗位画像——
 * 面完这场，这个岗位在 Roles 和 Studio 里就都在了，不用再贴一遍。
 */
export async function POST(req: NextRequest) {
  let body: { jd?: unknown; roleId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const rawJd = typeof body.jd === "string" ? body.jd.trim() : "";
  let roleId = Number.isInteger(Number(body.roleId)) && Number(body.roleId) > 0
    ? Number(body.roleId)
    : null;

  try {
    // 粘了 JD：走和 Roles 页面同一条聚合路径，不另起一套
    if (rawJd.length >= 30) {
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
      roleId = verdict.mergeInto;
      if (roleId === null) {
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
        .values({ roleId, company: verdict.company || null, title: verdict.title, rawJd })
        .run();

      const group = db
        .select({ company: roleJds.company, title: roleJds.title, rawJd: roleJds.rawJd })
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
          company: group.length > 1 ? null : verdict.company || null,
        })
        .where(eq(roleProfiles.id, roleId))
        .run();
    }

    const role = roleId
      ? db.select().from(roleProfiles).where(eq(roleProfiles.id, roleId)).get()
      : null;

    const session = db
      .insert(mockSessions)
      .values({
        roleId: roleId ?? null,
        title: role?.title ?? "通用面试",
        rawJd: rawJd || null,
      })
      .returning()
      .get();

    const ctx = await buildContext(session.id, role ?? null, rawJd || null);
    const opening = await nextTurn(ctx);

    db.insert(mockTurns)
      .values({ sessionId: session.id, seq: 1, role: "interviewer", content: opening })
      .run();

    return NextResponse.json(
      {
        sessionId: session.id,
        roleId: roleId ?? null,
        roleTitle: role?.title ?? null,
        opening,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `开场失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
