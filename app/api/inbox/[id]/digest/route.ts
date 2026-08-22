import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems, insights, questions } from "@/lib/db/schema";
import { digestInboxItem } from "@/lib/digest-inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }

  const item = db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
  if (!item) return NextResponse.json({ error: "素材不存在" }, { status: 404 });

  let images: string[] = [];
  try {
    images = JSON.parse(item.images ?? "[]");
  } catch {
    images = [];
  }

  try {
    const result = await digestInboxItem({
      title: item.title,
      desc: item.desc,
      author: item.author,
      images: Array.isArray(images) ? images : [],
    });

    // 重新消化时先清掉上一轮的产物，避免重复堆积
    db.delete(insights).where(eq(insights.inboxItemId, id)).run();

    if (result.insights.length > 0) {
      db.insert(insights)
        .values(result.insights.map((i) => ({ ...i, inboxItemId: id })))
        .run();
    }
    if (result.questions.length > 0) {
      // 面经题进问题池，不挂岗位（roleId = null）
      db.insert(questions)
        .values(result.questions.map((q) => ({ ...q, roleId: null })))
        .run();
    }

    db.update(inboxItems)
      .set({ status: result.questions.length + result.insights.length > 0 ? "processed" : "failed" })
      .where(eq(inboxItems.id, id))
      .run();

    return NextResponse.json({
      id,
      company: result.company,
      imagesRead: result.imagesRead,
      questions: result.questions.length,
      insights: result.insights.length,
    });
  } catch (err) {
    db.update(inboxItems).set({ status: "failed" }).where(eq(inboxItems.id, id)).run();
    return NextResponse.json(
      { error: `消化失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
