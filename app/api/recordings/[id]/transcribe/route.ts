import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { recordings } from "@/lib/db/schema";
import { transcribe } from "@/lib/transcribe";

export const dynamic = "force-dynamic";
// 一小时的录音在 M 系列芯片上要几分钟
export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400 });
  }
  const row = db.select().from(recordings).where(eq(recordings.id, id)).get();
  if (!row) return NextResponse.json({ error: "录音不存在" }, { status: 404 });
  if (!row.mediaPath) {
    return NextResponse.json({ error: "文件还没落盘" }, { status: 400 });
  }

  try {
    const text = await transcribe(row.mediaPath, { language: "zh" });
    if (!text.trim()) {
      db.update(recordings)
        .set({ status: "failed", error: "转写出来是空的，可能整段没有人声" })
        .where(eq(recordings.id, id))
        .run();
      return NextResponse.json({ error: "转写出来是空的" }, { status: 502 });
    }
    db.update(recordings)
      .set({ transcript: text, status: "transcribed", error: null })
      .where(eq(recordings.id, id))
      .run();
    return NextResponse.json({ id, chars: text.length, transcript: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.update(recordings)
      .set({ status: "failed", error: msg.slice(0, 400) })
      .where(eq(recordings.id, id))
      .run();
    return NextResponse.json({ error: `转写失败：${msg}` }, { status: 502 });
  }
}
