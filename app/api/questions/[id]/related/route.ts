import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions } from "@/lib/db/schema";
import { findRelatedInbox } from "@/lib/related-inbox";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 开口之前先看一眼：这题面经里谁被问过、当时怎么答的 */
export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const q = db.select().from(questions).where(eq(questions.id, id)).get();
  if (!q) return NextResponse.json({ error: "题不存在" }, { status: 404 });

  return NextResponse.json({
    related: findRelatedInbox({
      id: q.id,
      text: q.text,
      clusterId: q.clusterId,
      topic: q.topic,
    }),
  });
}
