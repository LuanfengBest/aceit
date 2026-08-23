import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, experiences, questions, roleProfiles } from "@/lib/db/schema";
import { WorkShell } from "@/components/work-shell";
import { findReusableAnswer } from "@/lib/answer-reuse";
import { StudioBoard, type QuestionWithAnswers } from "@/components/studio/studio-board";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  const roles = db
    .select()
    .from(roleProfiles)
    .orderBy(desc(roleProfiles.createdAt), desc(roleProfiles.id))
    .all();

  const requested = Number(params.role);
  const activeRoleId = roles.some((r) => r.id === requested)
    ? requested
    : (roles[0]?.id ?? null);

  // 题分两层，不是全都跟着岗位走：
  //
  // 通用题（自我介绍、经历深挖、协作冲突）投哪个岗都会问，
  // 挂在岗位上就变成每个岗位各一份，打磨成果会散掉。所以全局一套，
  // 切岗位时不动。
  //
  // 岗位专属题才跟着岗位走：这个业务域的专门知识、这份 JD 点名的场景。
  const universalRows = db
    .select()
    .from(questions)
    .where(and(eq(questions.scope, "universal"), isNull(questions.mergedInto)))
    .orderBy(asc(questions.id))
    .all();

  const roleRows = activeRoleId
    ? db
        .select()
        .from(questions)
        .where(and(eq(questions.roleId, activeRoleId), isNull(questions.mergedInto)))
        .orderBy(asc(questions.id))
        .all()
    : [];

  // 面经里的领域题：有业务域但还没归到任何岗位画像下
  const wildRows = db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.source, "inbox"),
        isNull(questions.roleId),
        isNull(questions.mergedInto),
        ne(questions.scope, "universal")
      )
    )
    .orderBy(asc(questions.id))
    .all();

  // 去重：面经题可能同时命中两个集合
  const seen = new Set<number>();
  const rows = [...universalRows, ...roleRows, ...wildRows].filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

  const roleQuestionIds = new Set(roleRows.map((q) => q.id));

  const allAnswers = db.select().from(answers).orderBy(asc(answers.version)).all();
  const answersOf = (qid: number) => allAnswers.filter((a) => a.questionId === qid);

  // 追问跟着主问题走，不单独列进队列——单看一句「你具体做了什么」没有上下文
  const mains = rows.filter((q) => q.parentId === null);
  const items: QuestionWithAnswers[] = mains.map((question) => ({
    question,
    answers: answersOf(question.id),
    followUps: rows
      .filter((q) => q.parentId === question.id)
      .map((q) => ({ question: q, answers: answersOf(q.id) })),
    bucket: (question.scope === "universal"
      ? "universal"
      : roleQuestionIds.has(question.id)
        ? "role"
        : "wild") as "universal" | "role" | "wild",
    reusable: findReusableAnswer({
      id: question.id,
      clusterId: question.clusterId,
      scope: question.scope,
    }),
  }));

  const experienceTitles: Record<number, string> = {};
  for (const e of db
    .select({ id: experiences.id, title: experiences.title })
    .from(experiences)
    .all()) {
    experienceTitles[e.id] = e.title;
  }

  const answered = items.filter((i) => i.answers.length > 0).length;
  const locked = items.filter((i) => i.answers.some((a) => a.status === "keeper")).length;
  const withFollowUps = items.filter((i) => i.followUps.length > 0).length;
  const kinds = new Set(items.map((i) => i.question.kind));

  return (
    <WorkShell
      meta="Layer 04"
      title="Story Studio"
      subtitle="Aceit asks out loud, you answer out loud. Every take is kept, so you can hear which version was actually better."
      image="/images/story-1.webp"
      field="roles"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Questions
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {items.length} questions · {kinds.size}/5 kinds covered ·{" "}
          {items.length > 0 ? Math.round((withFollowUps / items.length) * 100) : 0}% go deeper ·{" "}
          {locked} locked
        </p>
      </div>

      <StudioBoard
        activeRole={roles.find((r) => r.id === activeRoleId) ?? null}
        roles={roles}
        activeRoleId={activeRoleId}
        items={items}
        experienceTitles={experienceTitles}
      />
    </WorkShell>
  );
}
