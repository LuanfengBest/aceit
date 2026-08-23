import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { transcribe } from "@/lib/transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 转一小段实时音频。
 * 和面试录音那条不一样：这里不落库、转完就把临时文件删掉——
 * 面试进行中的音频没有留存的必要，留着反而是负担。
 */
export async function POST(req: NextRequest) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength < 512) {
    return NextResponse.json({ text: "" });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "aceit-live-"));
  const file = path.join(dir, "chunk.webm");
  try {
    await writeFile(file, buf);
    const text = await transcribe(file, { language: "zh" });
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
