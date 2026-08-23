import { and, asc, desc, eq, isNull } from "drizzle-orm";
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

  // 这个岗位生成的题
  const roleRows = activeRoleId
    ? db
        .select()
        .from(questions)
        .where(and(eq(questions.roleId, activeRoleId), isNull(questions.mergedInto)))
        .orderBy(asc(questions.id))
        .all()
    : [];

  // 面经里别人真被问过的题：不挂岗位，但同样值得练
  const wildRows = db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.source, "inbox"),
        isNull(questions.roleId),
        isNull(questions.mergedInto)
      )
    )
    .orderBy(asc(questions.id))
    .all();

  const rows = [...roleRows, ...wildRows];

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
          {items.length} to practise · {wildRows.length} from the wild · {answered} drafted ·{" "}
          {locked} locked
        </p>
      </div>

      <StudioBoard
        roles={roles}
        activeRoleId={activeRoleId}
        items={items}
        experienceTitles={experienceTitles}
      />
    </WorkShell>
  );
}
