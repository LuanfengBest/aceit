import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profileDocs, experiences } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** 清空全部素材：文档 + 片段。片段靠外键级联跟着走，这里再显式删一次兜底 */
export async function DELETE() {
  const docs = db.select({ id: profileDocs.id }).from(profileDocs).all().length;
  const frags = db.select({ id: experiences.id }).from(experiences).all().length;

  db.delete(experiences).run();
  db.delete(profileDocs).run();

  return NextResponse.json({ deletedDocs: docs, deletedExperiences: frags });
}
