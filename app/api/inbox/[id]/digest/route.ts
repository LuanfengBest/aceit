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

  const parseList = (raw: string | null): string[] => {
    try {
      const v = JSON.parse(raw ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const images = parseList(item.images);
  const frames = parseList(item.frames);

  if (item.type === "video" && frames.length === 0) {
    db.update(inboxItems).set({ status: "failed" }).where(eq(inboxItems.id, id)).run();
    return NextResponse.json(
      {
        error:
          "这条视频是旧版扩展采的，没有画面帧，而小红书视频直链已过期。用新版扩展重新采集一次即可。",
      },
      { status: 400 }
    );
  }

  try {
    const result = await digestInboxItem({
      title: item.title,
      desc: item.desc,
      author: item.author,
      images,
      frames,
      isVideo: item.type === "video",
    });

    // 重新消化时先清掉上一轮的产物，避免重复堆积
    db.delete(insights).where(eq(insights.inboxItemId, id)).run();

    if (result.insights.length > 0) {
      db.insert(insights)
        .values(result.insights.map((i) => ({ ...i, inboxItemId: id })))
        .run();
    }
    if (result.questions.length > 0) {
      // 面经题进问题池，不挂岗位（roleId = null）。
      // 先按顺序插入拿到 id，再把追问的 parentId 补上。
      const ids: number[] = [];
      for (const q of result.questions) {
        const { follows: _follows, ...row } = q;
        const created = db
          .insert(questions)
          .values({ ...row, roleId: null })
          .returning({ id: questions.id })
          .get();
        ids.push(created.id);
      }
      result.questions.forEach((q, i) => {
        if (q.follows !== null && ids[q.follows] !== undefined) {
          db.update(questions)
            .set({ parentId: ids[q.follows] })
            .where(eq(questions.id, ids[i]))
            .run();
        }
      });
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
