import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { roleProfiles } from "@/lib/db/schema";
import { extractRole } from "@/lib/extract-role";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { jd?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const rawJd = typeof body.jd === "string" ? body.jd.trim() : "";
  if (rawJd.length < 30) {
    return NextResponse.json({ error: "JD 太短了，粘完整一点" }, { status: 400 });
  }

  try {
    const extracted = await extractRole(rawJd);
    const created = db
      .insert(roleProfiles)
      .values({ ...extracted, rawJd })
      .returning()
      .get();
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: `抽取失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
