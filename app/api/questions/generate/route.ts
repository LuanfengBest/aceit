import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { questions, roleProfiles, experiences, inboxItems } from "@/lib/db/schema";
import { generateQuestions } from "@/lib/generate-questions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const list = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function POST(req: NextRequest) {
  let body: { roleId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const roleId = Number(body.roleId);
  if (!Number.isInteger(roleId)) {
    return NextResponse.json({ error: "缺少 roleId" }, { status: 400 });
  }

  const role = db.select().from(roleProfiles).where(eq(roleProfiles.id, roleId)).get();
  if (!role) return NextResponse.json({ error: "岗位不存在" }, { status: 404 });

  const exps = db.select().from(experiences).all();
  if (exps.length === 0) {
    return NextResponse.json(
      { error: "经历库是空的，先去 Material 传一份简历" },
      { status: 400 }
    );
  }

  // inbox 里已处理的素材当情报用
  const signals = db.select().from(inboxItems).all();

  try {
    const generated = await generateQuestions({
      role: {
        title: role.title,
        company: role.company,
        responsibilities: list(role.responsibilities),
        requirements: list(role.requirements),
        niceToHave: list(role.niceToHave),
        keywords: list(role.keywords),
      },
      experiences: exps.map((e) => ({
        title: e.title,
        summary: e.summary,
        tags: list(e.tags),
      })),
      signals: signals.map((s) => ({
        title: s.title ?? "(无标题)",
        desc: s.desc ?? "",
      })),
    });

    if (generated.length === 0) {
      return NextResponse.json({ error: "没有生成出问题" }, { status: 502 });
    }

    // 重新生成时清掉这个岗位上一批题（答案随之级联删除）
    db.delete(questions).where(eq(questions.roleId, roleId)).run();
    db.insert(questions)
      .values(generated.map((q) => ({ ...q, roleId })))
      .run();

    return NextResponse.json({ roleId, count: generated.length }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: `出题失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
