import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { experiences, questions, roleProfiles } from "@/lib/db/schema";
import { suggestQuestions, type Suggested } from "@/lib/suggest-questions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const list = (raw: string) => {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
};

/**
 * 补题。分两步：
 * POST { instruction } → 出一批**先不落库**的题，人挑完再存
 * POST { accept }      → 把挑中的存进题库
 * 补题是反复的动作，每次都直接写库会越攒越脏
 */
export async function POST(req: NextRequest) {
  let body: {
    instruction?: unknown;
    roleId?: unknown;
    experienceId?: unknown;
    accept?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const roleId =
    Number.isInteger(Number(body.roleId)) && Number(body.roleId) > 0
      ? Number(body.roleId)
      : null;

  /* ── 第二步：存下挑中的 ── */
  if (Array.isArray(body.accept)) {
    const rows = body.accept as Suggested[];
    const ids: number[] = [];
    for (const q of rows) {
      if (!q?.text?.trim()) continue;
      const r = db
        .insert(questions)
        .values({
          text: q.text.trim(),
          kind: q.kind as "behavioral" | "technical" | "case" | "resume" | "other",
          scope: q.scope === "domain" ? "domain" : "universal",
          clusterId: q.cluster,
          rationale: q.rationale,
          source: "manual",
          // 通用题不绑岗位，和队列的两层结构对齐
          roleId: q.scope === "domain" ? roleId : null,
        })
        .run();
      ids.push(Number(r.lastInsertRowid));
    }
    rows.forEach((q, i) => {
      if (q.follows === null || q.follows === undefined) return;
      if (ids[q.follows] === undefined || ids[i] === undefined) return;
      db.update(questions)
        .set({ parentId: ids[q.follows] })
        .where(eq(questions.id, ids[i]))
        .run();
    });
    return NextResponse.json({ saved: ids.length }, { status: 201 });
  }

  /* ── 第一步：出题，不落库 ── */
  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (instruction.length < 2) {
    return NextResponse.json({ error: "说一下你想补什么" }, { status: 400 });
  }

  const experienceId =
    Number.isInteger(Number(body.experienceId)) && Number(body.experienceId) > 0
      ? Number(body.experienceId)
      : null;

  const allExp = db.select().from(experiences).all();
  const focus = experienceId ? allExp.find((e) => e.id === experienceId) : null;
  const role = roleId
    ? db.select().from(roleProfiles).where(eq(roleProfiles.id, roleId)).get()
    : null;

  const existing = db
    .select({ text: questions.text })
    .from(questions)
    .where(and(isNull(questions.mergedInto), isNull(questions.parentId)))
    .all()
    .map((q) => q.text);

  try {
    const result = await suggestQuestions({
      instruction,
      role: role
        ? {
            title: role.title,
            domain: role.domain,
            requirements: list(role.requirements),
            variance: list(role.variance),
          }
        : null,
      focus: focus
        ? { title: focus.title, summary: focus.summary ?? "", detail: focus.detail ?? "" }
        : null,
      others: allExp
        .filter((e) => e.id !== experienceId)
        .map((e) => ({ title: e.title, summary: e.summary ?? "" })),
      existing,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `补题失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
