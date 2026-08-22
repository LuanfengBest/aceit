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
  };
  const topicL1 = typeof body.topic_l1 === "string" ? body.topic_l1.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topicL1 || !topic) {
    return NextResponse.json({ error: "要给出一级和二级分类" }, { status: 400 });
  }

  // 追问单独改会和主问题拆散，所以从主问题那一层开始动
  const rootId = target.parentId ?? id;
  const family = familyOf(rootId);

  db.update(questions)
    .set({ topicL1, topic })
    .where(inArray(questions.id, family))
    .run();
  db.update(insights)
    .set({ topicL1, topic })
    .where(inArray(insights.questionId, family))
    .run();

  return NextResponse.json({ id: rootId, moved: family.length, topicL1, topic });
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
