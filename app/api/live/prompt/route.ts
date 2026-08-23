import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, experiences, questions, roleProfiles } from "@/lib/db/schema";
import { livePrompt } from "@/lib/live-prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 听到一个问题，给提示。
 *
 * 「你练过的那版答案」是这里最有价值的东西——花时间打磨过的，
 * 比现出的框架靠谱得多，所以摆在最前面。
 *
 * 匹配交给模型，不用文本相似度：面试官换个说法
 * （「请做一下自我介绍」→「简单做个自我介绍，重点讲讲你负责过什么」）
 * 2-gram 重合度就掉到 0.33，配不上。而需要匹配的只有
 * 「已经练过的题」这一小撮，塞进同一次调用不增加延迟。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    recent?: unknown;
    roleId?: unknown;
  };
  const recent = typeof body.recent === "string" ? body.recent.trim() : "";
  if (recent.length < 8) return NextResponse.json({ asked: false });

  const roleId =
    Number.isInteger(Number(body.roleId)) && Number(body.roleId) > 0
      ? Number(body.roleId)
      : null;

  const exps = db
    .select({ title: experiences.title, summary: experiences.summary })
    .from(experiences)
    .all();
  const role = roleId
    ? db.select().from(roleProfiles).where(eq(roleProfiles.id, roleId)).get()
    : null;

  // 只有练过的题才需要匹配——没答案的匹配上了也没东西可摆
  const answered = db
    .selectDistinct({ id: questions.id, text: questions.text })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(isNull(questions.mergedInto))
    .all();

  try {
    const prompt = await livePrompt({
      recent,
      experiences: exps.map((e) => ({ title: e.title, summary: e.summary ?? "" })),
      role: role ? { title: role.title, domain: role.domain } : null,
      answered,
    });

    if (!prompt.asked || !prompt.question) {
      return NextResponse.json({ asked: false });
    }

    let prepared: { questionText: string; content: string; version: number } | null = null;
    if (prompt.matchesId !== null) {
      const hit = answered.find((q) => q.id === prompt.matchesId);
      const own =
        db
          .select()
          .from(answers)
          .where(
            and(eq(answers.questionId, prompt.matchesId), eq(answers.status, "keeper"))
          )
          .get() ??
        db
          .select()
          .from(answers)
          .where(eq(answers.questionId, prompt.matchesId))
          .orderBy(desc(answers.version))
          .get();
      if (hit && own) {
        prepared = { questionText: hit.text, content: own.content, version: own.version };
      }
    }

    return NextResponse.json({ ...prompt, prepared });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
