import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems, insights, questions } from "@/lib/db/schema";
import { digestInboxItem } from "@/lib/digest-inbox";
import { transcribe } from "@/lib/transcribe";

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

  // 视频：先转文字。口播视频的内容在话里，不在画面上
  let transcript = item.transcript;
  if (item.type === "video" && !transcript) {
    if (!item.mediaPath) {
      db.update(inboxItems).set({ status: "failed" }).where(eq(inboxItems.id, id)).run();
      return NextResponse.json(
        {
          error:
            "这条视频没有存下文件，而小红书视频直链已过期。用新版扩展重新采集一次即可。",
        },
        { status: 400 }
      );
    }
    try {
      transcript = await transcribe(item.mediaPath);
      db.update(inboxItems).set({ transcript }).where(eq(inboxItems.id, id)).run();
    } catch (err) {
      db.update(inboxItems).set({ status: "failed" }).where(eq(inboxItems.id, id)).run();
      return NextResponse.json(
        { error: `转写失败：${err instanceof Error ? err.message : String(err)}` },
        { status: 502 }
      );
    }
  }

  try {
    const result = await digestInboxItem({
      title: item.title,
      desc: item.desc,
      author: item.author,
      images,
      frames,
      isVideo: item.type === "video",
      transcript,
    });

    // 重新消化时先清掉这条素材上一轮的产物，避免重复堆积
    db.delete(insights).where(eq(insights.inboxItemId, id)).run();
    db.delete(questions).where(eq(questions.inboxItemId, id)).run();

    // 先插题：知识要挂到题上，得先有题的 id
    const questionIds: number[] = [];
    for (const q of result.questions) {
      const { follows: _follows, ...row } = q;
      const created = db
        .insert(questions)
        .values({ ...row, roleId: null, inboxItemId: id })
        .returning({ id: questions.id })
        .get();
      questionIds.push(created.id);
    }
    result.questions.forEach((q, i) => {
      if (q.follows !== null && questionIds[q.follows] !== undefined) {
        db.update(questions)
          .set({ parentId: questionIds[q.follows] })
          .where(eq(questions.id, questionIds[i]))
          .run();
      }
    });

    if (result.insights.length > 0) {
      db.insert(insights)
        .values(
          result.insights.map(({ answers, ...row }) => ({
            ...row,
            inboxItemId: id,
            // 下标翻译成真实的 question id
            questionId:
              answers !== null && questionIds[answers] !== undefined
                ? questionIds[answers]
                : null,
          }))
        )
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
      transcriptChars: transcript?.length ?? 0,
      questions: result.questions.length,
      insights: result.insights.length,
      dropped: result.dropped,
      linked: result.insights.filter((i) => i.answers !== null).length,
    });
  } catch (err) {
    db.update(inboxItems).set({ status: "failed" }).where(eq(inboxItems.id, id)).run();
    return NextResponse.json(
      { error: `消化失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
