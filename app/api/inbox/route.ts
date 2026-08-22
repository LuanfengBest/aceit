import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonWithCors(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function toJsonStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonWithCors({ error: "invalid JSON body" }, 400);
  }

  const sourceId = body.source_id;
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return jsonWithCors({ error: "source_id is required" }, 400);
  }

  const values = {
    source: typeof body.source === "string" ? body.source : "xiaohongshu",
    sourceId,
    sourceUrl: typeof body.source_url === "string" ? body.source_url : null,
    type: body.type === "video" ? ("video" as const) : ("normal" as const),
    title: typeof body.title === "string" ? body.title : null,
    desc: typeof body.desc === "string" ? body.desc : null,
    author: typeof body.author === "string" ? body.author : null,
    images: toJsonStringOrNull(body.images),
    videoUrl: typeof body.video_url === "string" ? body.video_url : null,
    tags: toJsonStringOrNull(body.tags),
    publishedAt:
      typeof body.published_at === "string" ? body.published_at : null,
    raw: JSON.stringify(body),
  };

  // 视频帧：扩展在采集当下抽好的 data URL，落到本地文件，DB 里只存路径
  async function saveFrames(itemId: number): Promise<string> {
    const raw = body.frames;
    if (!Array.isArray(raw) || raw.length === 0) return "[]";

    const dir = path.join(process.cwd(), "data", "frames", String(itemId));
    await mkdir(dir, { recursive: true });

    const saved: string[] = [];
    for (let i = 0; i < Math.min(raw.length, 8); i++) {
      const entry = raw[i];
      if (typeof entry !== "string") continue;
      const match = /^data:image\/(\w+);base64,(.+)$/.exec(entry);
      if (!match) continue;
      const file = path.join(dir, `${i}.${match[1] === "jpeg" ? "jpg" : match[1]}`);
      await writeFile(file, Buffer.from(match[2], "base64"));
      saved.push(file);
    }
    return JSON.stringify(saved);
  }

  const existing = db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(eq(inboxItems.sourceId, sourceId))
    .get();

  if (existing) {
    const frames = await saveFrames(existing.id);
    db.update(inboxItems)
      .set({ ...values, frames })
      .where(eq(inboxItems.sourceId, sourceId))
      .run();
    return jsonWithCors({ status: "updated", id: existing.id, frames: JSON.parse(frames).length });
  }

  const result = db.insert(inboxItems).values(values).run();
  const id = Number(result.lastInsertRowid);
  const frames = await saveFrames(id);
  if (frames !== "[]") {
    db.update(inboxItems).set({ frames }).where(eq(inboxItems.id, id)).run();
  }
  return jsonWithCors(
    { status: "created", id, frames: JSON.parse(frames).length },
    201
  );
}
