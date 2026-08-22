import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems, insights, questions } from "@/lib/db/schema";
import { WorkShell } from "@/components/work-shell";
import { DigestPanel, type DigestRow } from "@/components/inbox/digest-panel";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  approach: "How to answer",
  company: "Company intel",
  term: "Terminology",
  pitfall: "Pitfall",
};

const KIND_TONE: Record<string, string> = {
  approach: "bg-mint text-mint-ink",
  company: "bg-lavender text-lavender-ink",
  term: "bg-lemon text-lemon-ink",
  pitfall: "bg-peach text-peach-ink",
};

/** 一道题下面挂的答法：别人是怎么答的 */
function QuestionAnswers({
  rows,
}: {
  rows: { insight: { id: number; title: string; content: string }; sourceUrl: string | null }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {rows.map(({ insight, sourceUrl }) => (
        <div
          key={insight.id}
          className="rounded-md border border-mint bg-mint/40 px-3.5 py-2.5"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-meta uppercase tracking-[0.1em] text-mint-ink">
              How they answered
            </span>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-meta text-muted-foreground underline decoration-border underline-offset-4"
              >
                原文 ↗
              </a>
            )}
          </div>
          <p className="mt-1 text-meta text-foreground">{insight.title}</p>
          <p className="mt-1 text-meta text-muted-foreground">{insight.content}</p>
        </div>
      ))}
    </div>
  );
}

export default async function InboxPage() {
  const items = db
    .select()
    .from(inboxItems)
    .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
    .all();

  const allInsights = db
    .select({
      insight: insights,
      sourceTitle: inboxItems.title,
      sourceUrl: inboxItems.sourceUrl,
    })
    .from(insights)
    .leftJoin(inboxItems, eq(insights.inboxItemId, inboxItems.id))
    .where(isNull(insights.mergedInto))
    .orderBy(desc(insights.id))
    .all();

  const inboxQuestions = db
    .select()
    .from(questions)
    .where(and(eq(questions.source, "inbox"), isNull(questions.mergedInto)))
    .all();

  // 挂在题上的答法，按题分组
  const answersByQuestion = new Map<number, typeof allInsights>();
  for (const row of allInsights) {
    const qid = row.insight.questionId;
    if (qid !== null) {
      answersByQuestion.set(qid, [...(answersByQuestion.get(qid) ?? []), row]);
    }
  }

  // 追问挂到主问题下
  const followUps = new Map<number, typeof inboxQuestions>();
  for (const q of inboxQuestions) {
    if (q.parentId !== null) {
      followUps.set(q.parentId, [...(followUps.get(q.parentId) ?? []), q]);
    }
  }
  const mains = inboxQuestions.filter((q) => q.parentId === null);

  // 主问题按主题归组
  const qByTopic = new Map<string, typeof mains>();
  for (const q of mains) {
    const key = q.topic ?? "未分类";
    qByTopic.set(key, [...(qByTopic.get(key) ?? []), q]);
  }
  const questionTopics = [...qByTopic.entries()].sort((a, b) => b[1].length - a[1].length);

  // What to steal 只放没挂到具体题上的通用知识（踩坑、黑话、公司情报）
  const generalInsights = allInsights.filter((r) => r.insight.questionId === null);
  const iByTopic = new Map<string, typeof allInsights>();
  for (const row of generalInsights) {
    const key = row.insight.topic ?? "未分类";
    iByTopic.set(key, [...(iByTopic.get(key) ?? []), row]);
  }
  const insightTopics = [...iByTopic.entries()].sort((a, b) => b[1].length - a[1].length);

  const rows: DigestRow[] = items.map((item) => {
    let imageCount = 0;
    try {
      const parsed = JSON.parse(item.images ?? "[]");
      imageCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      imageCount = 0;
    }
    return {
      id: item.id,
      title: item.title || "(no title)",
      status: item.status,
      type: item.type,
      imageCount,
      questionCount: 0,
      insightCount: allInsights.filter((r) => r.insight.inboxItemId === item.id).length,
    };
  });

  const below = (
    <div className="space-y-10">
      {/* 题：主题 → 主问题 → 追问 */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
            Questions from the wild
          </p>
          <p className="font-mono text-meta text-muted-foreground">
            {mains.length} main · {inboxQuestions.length - mains.length} follow-ups ·{" "}
            {questionTopics.length} topics
          </p>
        </div>

        {questionTopics.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
            Nothing yet. Digest a signal above.
          </p>
        ) : (
          <div className="space-y-2">
            {questionTopics.map(([topic, qs]) => (
              <details
                key={topic}
                open={qs.length >= 2}
                className="rounded-lg border border-border bg-surface"
              >
                <summary className="flex cursor-pointer items-center gap-3 px-5 py-3.5">
                  <span className="text-section">{topic}</span>
                  <span className="ml-auto font-mono text-meta text-muted-foreground">
                    {qs.length}
                  </span>
                </summary>
                <ul className="space-y-4 border-t border-border px-5 py-4">
                  {qs.map((q) => {
                    const kids = followUps.get(q.id) ?? [];
                    return (
                      <li key={q.id}>
                        <p className="text-body">{q.text}</p>

                        <QuestionAnswers rows={answersByQuestion.get(q.id) ?? []} />

                        {kids.length > 0 && (
                          <ul className="mt-2.5 space-y-2.5 border-l border-border pl-4">
                            {kids.map((k) => (
                              <li key={k.id}>
                                <p className="text-meta text-muted-foreground">↳ {k.text}</p>
                                <QuestionAnswers rows={answersByQuestion.get(k.id) ?? []} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* 知识：按主题 */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
              General playbook
            </p>
            <p className="mt-0.5 text-meta text-muted-foreground">
              Pitfalls and terminology that aren&rsquo;t tied to one question
            </p>
          </div>
          <p className="font-mono text-meta text-muted-foreground">
            {generalInsights.length} in {insightTopics.length} topics
          </p>
        </div>

        {insightTopics.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          <div className="space-y-2">
            {insightTopics.map(([topic, rows]) => (
              <details
                key={topic}
                open={rows.length >= 3}
                className="rounded-lg border border-border bg-surface"
              >
                <summary className="flex cursor-pointer items-center gap-3 px-5 py-3.5">
                  <span className="text-section">{topic}</span>
                  <span className="ml-auto font-mono text-meta text-muted-foreground">
                    {rows.length}
                  </span>
                </summary>
                <ul className="space-y-4 border-t border-border px-5 py-4">
                  {rows.map(({ insight: i, sourceTitle, sourceUrl }) => (
                    <li key={i.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-pill px-2.5 py-0.5 text-meta ${KIND_TONE[i.kind]}`}>
                          {KIND_LABEL[i.kind]}
                        </span>
                        {i.company && (
                          <span className="font-mono text-meta text-muted-foreground">
                            {i.company}
                          </span>
                        )}
                        {sourceUrl ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto max-w-[18rem] truncate text-meta text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                          >
                            {sourceTitle || "原文"} ↗
                          </a>
                        ) : (
                          sourceTitle && (
                            <span className="ml-auto max-w-[18rem] truncate text-meta text-muted-foreground">
                              {sourceTitle}
                            </span>
                          )
                        )}
                      </div>
                      <p className="mt-2 text-body">{i.title}</p>
                      <p className="mt-1 text-meta text-muted-foreground">{i.content}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <WorkShell
      meta="Layer 02"
      title="Inbox"
      subtitle="Paste anything useful you run into. Aceit reads it so you don't have to remember it."
      image="/images/work-3.jpg"
      field="inbox"
      below={below}
    >
      <div className="mb-5 rounded-lg border border-border bg-surface-2 p-5">
        <p className="text-body">
          Found an interview debrief? A teardown of the team you&rsquo;re about to meet? Drop it
          here — Aceit reads it (
          <span className="text-foreground">including the text inside screenshots</span>), pulls
          out <span className="text-foreground">the questions they asked</span> and{" "}
          <span className="text-foreground">how the good answers were structured</span>.
        </p>
        <p className="mt-3 font-mono text-meta text-muted-foreground">
          ⌘⇧S ON ANY 小红书 NOTE WITH THE EXTENSION
        </p>
      </div>

      <DigestPanel rows={rows} />
    </WorkShell>
  );
}
