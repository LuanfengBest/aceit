import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { answers, experiences, questions, roleProfiles } from "@/lib/db/schema";
import { WorkShell } from "@/components/work-shell";
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
  const items: QuestionWithAnswers[] = rows.map((question) => ({
    question,
    answers: allAnswers.filter((a) => a.questionId === question.id),
  }));

  const experienceTitles: Record<number, string> = {};
  for (const e of db
    .select({ id: experiences.id, title: experiences.title })
    .from(experiences)
    .all()) {
    experienceTitles[e.id] = e.title;
  }

  const answered = items.filter((i) => i.answers.length > 0).length;

  return (
    <WorkShell
      meta="Layer 04"
      title="Story Studio"
      subtitle="Every question this role will ask, and your best answer to each — sharpened one version at a time."
      image="/images/story-1.webp"
      field="roles"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Questions
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {roleRows.length} for this role · {wildRows.length} from the wild · {answered} drafted
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
