import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { interviewQas, questions, recordings, roleProfiles } from "@/lib/db/schema";
import { WorkShell } from "@/components/work-shell";
import { DebriefForm } from "@/components/debrief/debrief-form";
import { InterviewRecorder } from "@/components/debrief/interview-recorder";
import { LivePrompter } from "@/components/debrief/live-prompter";
import { RecordingList } from "@/components/debrief/recording-list";

export const dynamic = "force-dynamic";

export default async function DebriefPage() {
  const roles = db
    .select()
    .from(roleProfiles)
    .orderBy(desc(roleProfiles.createdAt))
    .all();

  const rows = db
    .select({ qa: interviewQas, questionText: questions.text })
    .from(interviewQas)
    .leftJoin(questions, eq(interviewQas.questionId, questions.id))
    .orderBy(desc(interviewQas.createdAt), desc(interviewQas.id))
    .all();

  const recs = db
    .select()
    .from(recordings)
    .orderBy(desc(recordings.createdAt), desc(recordings.id))
    .all();

  // 「没准备过」现在是按 source 判的：复盘时补进题库的题 source=interview。
  // 之前判 questionId is null，可那些题现在都补进库了，永远数不出来
  const askedIds = rows.map((r) => r.qa.questionId).filter((x): x is number => x !== null);
  const freshIds = new Set(
    askedIds.length > 0
      ? db
          .select({ id: questions.id })
          .from(questions)
          .where(eq(questions.source, "interview"))
          .all()
          .map((q) => q.id)
      : []
  );
  const unprepared = rows.filter(
    (r) => r.qa.questionId === null || freshIds.has(r.qa.questionId)
  ).length;

  return (
    <WorkShell
      meta="Layer 05"
      title="Debrief"
      subtitle="What they actually asked, and how it actually went — folded back into your library."
      image="/images/story-2.webp"
      field="inbox"
    >
      <div className="mb-5 flex items-baseline justify-between">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Log a round
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {rows.length} logged
          {unprepared > 0 && <span className="text-danger"> · {unprepared} unprepared</span>}
        </p>
      </div>

      {/* 面试进行中用提词，面试结束后用录音复盘。两件事，同一页 */}
      <div className="mb-4">
        <LivePrompter roles={roles.map((r) => ({ id: r.id, title: r.title }))} />
      </div>

      <InterviewRecorder roles={roles.map((r) => ({ id: r.id, title: r.title }))} />

      <RecordingList
        rows={recs.map((r) => ({
          id: r.id,
          company: r.company,
          round: r.round,
          status: r.status,
          error: r.error,
          bytes: r.bytes,
          durationSeconds: r.durationSeconds,
          transcript: r.transcript,
          interviewedAt: r.interviewedAt,
        }))}
      />

      <details className="mt-4 rounded-lg border border-border bg-surface px-5 py-3">
        <summary className="cursor-pointer font-mono text-meta uppercase tracking-[0.1em] text-muted-foreground">
          Or just type what you remember
        </summary>
        <div className="mt-3">
          <DebriefForm roles={roles} />
        </div>
      </details>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-surface px-5 py-10 text-center text-meta text-muted-foreground">
          Nothing logged yet. After your next round, come here first — before you forget the
          wording.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map(({ qa, questionText }) => (
            <article key={qa.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex items-start justify-between gap-4">
                <p className="text-body">{qa.askedText}</p>
                <span
                  className={`shrink-0 rounded-pill px-2.5 py-0.5 text-meta ${
                    qa.questionId
                      ? "bg-mint text-mint-ink"
                      : "bg-peach text-peach-ink"
                  }`}
                >
                  {qa.questionId && !freshIds.has(qa.questionId)
                    ? "Prepared"
                    : "Never prepped"}
                </span>
              </div>

              {questionText && (
                <p className="mt-2 text-meta text-muted-foreground">
                  {qa.questionId && freshIds.has(qa.questionId)
                    ? "Added to your bank — practise it in Studio"
                    : `Matches: ${questionText}`}
                </p>
              )}
              {qa.myAnswer && (
                <p className="mt-3 whitespace-pre-wrap text-meta text-muted-foreground">
                  <span className="font-mono uppercase tracking-[0.1em]">Said</span> · {qa.myAnswer}
                </p>
              )}
              {qa.reflection && (
                <p className="mt-2 text-meta text-accent">{qa.reflection}</p>
              )}

              <p className="mt-3 font-mono text-meta text-muted-foreground">
                {[qa.company, qa.round, qa.interviewedAt].filter(Boolean).join(" · ") || "—"}
              </p>
            </article>
          ))}
        </div>
      )}
    </WorkShell>
  );
}
