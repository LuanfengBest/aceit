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

  const existing = db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(eq(inboxItems.sourceId, sourceId))
    .get();

  if (existing) {
    db.update(inboxItems)
      .set(values)
      .where(eq(inboxItems.sourceId, sourceId))
      .run();
    return jsonWithCors({ status: "updated", id: existing.id });
  }

  const result = db.insert(inboxItems).values(values).run();
  return jsonWithCors({ status: "created", id: Number(result.lastInsertRowid) }, 201);
}
