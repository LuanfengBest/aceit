import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { insights, questions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 一道主问题连带它的追问。删和改分类都要按这一整族来动 */
function familyOf(id: number): number[] {
  const kids = db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.parentId, id))
    .all()
    .map((r) => r.id);
  return [id, ...kids];
}

/** 改分类。追问跟着主问题走，挂在这些题上的答法也一起改 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  const target = db.select().from(questions).where(eq(questions.id, id)).get();
  if (!target) {
    return NextResponse.json({ error: "题不存在" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    topic_l1?: unknown;
    topic?: unknown;
    scope?: unknown;
    role_id?: unknown;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.topic_l1 === "string" && body.topic_l1.trim()) {
    patch.topicL1 = body.topic_l1.trim();
  }
  if (typeof body.topic === "string" && body.topic.trim()) {
    patch.topic = body.topic.trim();
  }
  // 在「通用」和「岗位专属」之间搬。通用题不绑岗位——
  // 绑上去就成了每个岗位各一份，打磨成果会散掉
  if (body.scope === "universal" || body.scope === "domain") {
    patch.scope = body.scope;
    patch.roleId = body.scope === "universal" ? null : (body.role_id ?? null);
  } else if (body.role_id === null || Number.isInteger(body.role_id)) {
    patch.roleId = body.role_id;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "没有要改的字段" }, { status: 400 });
  }

  // 追问单独改会和主问题拆散，所以从主问题那一层开始动
  const rootId = target.parentId ?? id;
  const family = familyOf(rootId);

  db.update(questions).set(patch).where(inArray(questions.id, family)).run();
  // 挂在这些题上的答法跟着走
  const insightPatch: Record<string, unknown> = {};
  if (patch.topicL1 !== undefined) insightPatch.topicL1 = patch.topicL1;
  if (patch.topic !== undefined) insightPatch.topic = patch.topic;
  if (Object.keys(insightPatch).length > 0) {
    db.update(insights)
      .set(insightPatch)
      .where(inArray(insights.questionId, family))
      .run();
  }

  return NextResponse.json({ id: rootId, moved: family.length, ...patch });
}

/**
 * 删题。连带追问和挂在这些题上的答法一起删——
 * insights.question_id 的外键是 set null，光删题的话
 * 那些答法会掉进 playbook 变成没头没尾的悬空条目。
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  const target = db.select().from(questions).where(eq(questions.id, id)).get();
  if (!target) {
    return NextResponse.json({ error: "题不存在" }, { status: 404 });
  }

  // 删主问题就整族删；删追问只删它自己
  const family = target.parentId === null ? familyOf(id) : [id];

  const droppedInsights = db
    .select({ id: insights.id })
    .from(insights)
    .where(inArray(insights.questionId, family))
    .all().length;

  db.delete(insights).where(inArray(insights.questionId, family)).run();
  db.delete(questions).where(inArray(questions.id, family)).run();

  return NextResponse.json({
    deleted: family.length,
    insightsDeleted: droppedInsights,
  });
}
