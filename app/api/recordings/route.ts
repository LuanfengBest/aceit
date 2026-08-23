import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { recordings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 收下一段面试录音。存本地，不上传任何地方——
 * 里面有公司信息和面试官原话，这是不能传第三方的东西。
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const roleIdRaw = Number(url.searchParams.get("roleId"));
  const roleId = Number.isInteger(roleIdRaw) && roleIdRaw > 0 ? roleIdRaw : null;
  const company = url.searchParams.get("company")?.trim() || null;
  const round = url.searchParams.get("round")?.trim() || null;
  const durationRaw = Number(url.searchParams.get("seconds"));
  const durationSeconds = Number.isFinite(durationRaw) ? Math.round(durationRaw) : null;

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength < 1024) {
    return NextResponse.json({ error: "录音是空的" }, { status: 400 });
  }
  if (buf.byteLength > 500 * 1024 * 1024) {
    return NextResponse.json({ error: "文件太大" }, { status: 413 });
  }

  const row = db
    .insert(recordings)
    .values({
      roleId,
      company,
      round,
      mediaPath: "",
      bytes: buf.byteLength,
      durationSeconds,
      interviewedAt: new Date().toISOString().slice(0, 10),
    })
    .returning()
    .get();

  const dir = path.join(process.cwd(), "data", "recordings");
  await mkdir(dir, { recursive: true });
  // 浏览器录出来的是 webm，whisper 那边走 ffmpeg，格式不挑
  const file = path.join(dir, `${row.id}.webm`);
  await writeFile(file, buf);

  db.update(recordings).set({ mediaPath: file }).where(eq(recordings.id, row.id)).run();

  return NextResponse.json(
    { id: row.id, bytes: buf.byteLength, seconds: durationSeconds },
    { status: 201 }
  );
}
