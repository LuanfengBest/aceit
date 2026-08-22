import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interviewQas, questions } from "@/lib/db/schema";
import { matchInterview } from "@/lib/match-interview";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { transcript?: unknown; roleId?: unknown; interviewedAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON" }, { status: 400 });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (transcript.length < 20) {
    return NextResponse.json({ error: "写详细一点，至少把问题列出来" }, { status: 400 });
  }

  const roleId = Number.isInteger(Number(body.roleId)) ? Number(body.roleId) : null;
  const interviewedAt =
    typeof body.interviewedAt === "string" && body.interviewedAt ? body.interviewedAt : null;

  const bank = db.select({ id: questions.id, text: questions.text }).from(questions).all();

  try {
    const result = await matchInterview(transcript, bank);
    if (result.items.length === 0) {
      return NextResponse.json({ error: "没能从这段文字里读出问题" }, { status: 502 });
    }

    db.insert(interviewQas)
      .values(
        result.items.map((i) => ({
          questionId: i.matchedQuestionId,
          roleId,
          company: result.company || null,
          round: result.round || null,
          askedText: i.askedText,
          myAnswer: i.myAnswer || null,
          reflection: i.reflection || null,
          interviewedAt,
        }))
      )
      .run();

    const matched = result.items.filter((i) => i.matchedQuestionId !== null).length;
    return NextResponse.json(
      {
        count: result.items.length,
        matched,
        unprepared: result.items.length - matched,
        company: result.company,
        round: result.round,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `整理失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
