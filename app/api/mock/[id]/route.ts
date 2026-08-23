import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mockSessions, mockTurns, questions, roleProfiles } from "@/lib/db/schema";
import { harvestQuestions, nextTurn } from "@/lib/mock-interview";
import { buildContext } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** 回答一轮，拿到面试官的下一句 */
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const session = db.select().from(mockSessions).where(eq(mockSessions.id, id)).get();
  if (!session) return NextResponse.json({ error: "这场不存在" }, { status: 404 });
  if (session.status === "ended") {
    return NextResponse.json({ error: "这场已经结束了" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { answer?: unknown };
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  if (answer.length < 2) {
    return NextResponse.json({ error: "没听到内容" }, { status: 400 });
  }

  const last = db
    .select({ seq: mockTurns.seq })
    .from(mockTurns)
    .where(eq(mockTurns.sessionId, id))
    .orderBy(desc(mockTurns.seq))
    .get();
  const base = last?.seq ?? 0;

  db.insert(mockTurns)
    .values({ sessionId: id, seq: base + 1, role: "me", content: answer })
    .run();

  try {
    const role = session.roleId
      ? (db.select().from(roleProfiles).where(eq(roleProfiles.id, session.roleId)).get() ??
        null)
      : null;
    const ctx = await buildContext(id, role, session.rawJd);
    const reply = await nextTurn(ctx);

    db.insert(mockTurns)
      .values({ sessionId: id, seq: base + 2, role: "interviewer", content: reply })
      .run();

    return NextResponse.json({ reply, seq: base + 2 });
  } catch (err) {
    return NextResponse.json(
      { error: `面试官卡住了：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}

/**
 * 结束这一场，把问过的题沉淀进题库。
 * 沉淀是 mock 的价值所在——临场问出来的题，下次在 Studio 里能接着练。
 */
export async function PATCH(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  const session = db.select().from(mockSessions).where(eq(mockSessions.id, id)).get();
  if (!session) return NextResponse.json({ error: "这场不存在" }, { status: 404 });

  const history = db
    .select({ role: mockTurns.role, content: mockTurns.content, id: mockTurns.id })
    .from(mockTurns)
    .where(eq(mockTurns.sessionId, id))
    .orderBy(mockTurns.seq)
    .all();

  db.update(mockSessions).set({ status: "ended" }).where(eq(mockSessions.id, id)).run();

  if (history.length < 3) {
    return NextResponse.json({ harvested: 0, note: "这场太短，没什么可沉淀的" });
  }

  try {
    const found = await harvestQuestions(
      history.map((t) => ({ role: t.role, content: t.content }))
    );
    if (found.length === 0) return NextResponse.json({ harvested: 0 });

    const ids: number[] = [];
    for (const q of found) {
      const r = db
        .insert(questions)
        .values({
          text: q.text,
          kind: q.kind as "behavioral" | "technical" | "case" | "resume" | "other",
          scope: q.scope,
          clusterId: q.cluster,
          rationale: q.rationale,
          source: "manual",
          // 通用题不绑岗位，和 Studio 的两层结构对齐
          roleId: q.scope === "domain" ? session.roleId : null,
        })
        .run();
      ids.push(Number(r.lastInsertRowid));
    }
    found.forEach((q, i) => {
      if (q.follows === null || ids[q.follows] === undefined) return;
      db.update(questions)
        .set({ parentId: ids[q.follows] })
        .where(eq(questions.id, ids[i]))
        .run();
    });

    return NextResponse.json({ harvested: found.length, questionIds: ids });
  } catch (err) {
    return NextResponse.json(
      { error: `沉淀失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
