import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type Params = { params: Promise<{ id: string }> };

/**
 * 扩展在采集当下把视频文件传上来。
 * 小红书视频直链带签名会过期，事后服务端拉不到，只能这个时候存下来。
 */
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "无效的 id" }, { status: 400, headers: CORS });
  }

  const item = db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
  if (!item) {
    return NextResponse.json({ error: "素材不存在" }, { status: 404, headers: CORS });
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength === 0) {
    return NextResponse.json({ error: "空文件" }, { status: 400, headers: CORS });
  }
  if (buf.byteLength > 200 * 1024 * 1024) {
    return NextResponse.json({ error: "文件太大" }, { status: 413, headers: CORS });
  }

  const dir = path.join(process.cwd(), "data", "media");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.mp4`);
  await writeFile(file, buf);

  db.update(inboxItems).set({ mediaPath: file }).where(eq(inboxItems.id, id)).run();

  return NextResponse.json(
    { id, bytes: buf.byteLength },
    { status: 201, headers: CORS }
  );
}
