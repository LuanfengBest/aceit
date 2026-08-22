import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { inboxItems, insights, questions } from "@/lib/db/schema";
import { CANONICAL_L1_NAMES, isCanonicalL1 } from "@/lib/taxonomy";
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
  rows: {
    insight: {
      id: number;
      title: string;
      content: string;
      evidence: string | null;
      evidenceKind: string | null;
    };
    sourceUrl: string | null;
    sourceTitle: string | null;
  }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {rows.map(({ insight, sourceUrl, sourceTitle }) => (
        <details key={insight.id} className="group">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-pill bg-mint px-2.5 py-0.5 font-mono text-meta uppercase tracking-[0.1em] text-mint-ink transition-opacity hover:opacity-80">
            <span className="transition-transform group-open:rotate-90">›</span>
            How they answered
          </summary>
          <div className="mt-2 rounded-md border border-mint bg-mint/35 px-3.5 py-2.5">
            <div className="flex items-baseline gap-2">
              <p className="text-meta text-foreground">{insight.title}</p>
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto max-w-[16rem] shrink-0 truncate text-meta text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                >
                  {sourceTitle || "原文"} ↗
                </a>
              )}
            </div>
            <p className="mt-1.5 text-meta text-muted-foreground">{insight.content}</p>
            {insight.evidence && (
              <div className="mt-2.5 border-t border-mint pt-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-mint-ink">
                  {insight.evidenceKind === "image" ? "From image" : "From text"}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
                  {insight.evidence}
                </p>
              </div>
            )}
          </div>
        </details>
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

  // 主问题按两级分类归组：一级 → 二级 → 题
  const tree = new Map<string, Map<string, typeof mains>>();
  for (const q of mains) {
    const l1 = q.topicL1 ?? "Uncategorized";
    const l2 = q.topic ?? "General";
    const branch = tree.get(l1) ?? new Map<string, typeof mains>();
    branch.set(l2, [...(branch.get(l2) ?? []), q]);
    tree.set(l1, branch);
  }
  // 固定的五个一级按 taxonomy 里的顺序排，模型新建的排在后面
  const l1Order = new Map(CANONICAL_L1_NAMES.map((n, i) => [n, i] as const));
  const questionTree = [...tree.entries()]
    .map(([l1, branch]) => ({
      l1,
      isNew: !isCanonicalL1(l1) && l1 !== "Uncategorized",
      total: [...branch.values()].reduce((n, list) => n + list.length, 0),
      groups: [...branch.entries()].sort((a, b) => b[1].length - a[1].length),
    }))
    .sort(
      (a, b) =>
        (l1Order.get(a.l1) ?? 99) - (l1Order.get(b.l1) ?? 99) || b.total - a.total
    );

  // Playbook 只放没挂到具体题上的通用知识，按 kind 分组——
  // 它们是元知识（黑话、踩坑、公司情报），套题的分类树上去反而重名
  const generalInsights = allInsights.filter((r) => r.insight.questionId === null);
  const PLAYBOOK_ORDER = ["pitfall", "term", "company", "approach"] as const;
  const iByKind = new Map<string, typeof allInsights>();
  for (const row of generalInsights) {
    const key = row.insight.kind;
    iByKind.set(key, [...(iByKind.get(key) ?? []), row]);
  }
  const insightGroups = [...iByKind.entries()].sort(
    (a, b) =>
      PLAYBOOK_ORDER.indexOf(a[0] as (typeof PLAYBOOK_ORDER)[number]) -
      PLAYBOOK_ORDER.indexOf(b[0] as (typeof PLAYBOOK_ORDER)[number])
  );

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
      sourceUrl: item.sourceUrl,
      transcript: item.transcript,
      status: item.status,
      type: item.type,
      imageCount,
      questionCount: inboxQuestions.filter((q) => q.inboxItemId === item.id).length,
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
            {questionTree.length} areas
          </p>
        </div>

        {questionTree.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
            Nothing yet. Digest a signal above.
          </p>
        ) : (
          <div className="space-y-3">
            {questionTree.map(({ l1, isNew, total, groups }) => (
              <details key={l1} className="rounded-lg border border-border bg-surface" open>
                <summary className="flex cursor-pointer items-center gap-2.5 px-5 py-3.5">
                  <span className="text-section">{l1}</span>
                  {isNew && (
                    <span className="rounded-pill bg-lemon px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-lemon-ink">
                      new area
                    </span>
                  )}
                  <span className="ml-auto font-mono text-meta text-muted-foreground">
                    {total}
                  </span>
                </summary>

                <div className="space-y-1 border-t border-border px-3 py-3">
                  {groups.map(([l2, qs]) => (
                    <details key={l2} className="rounded-md bg-surface-2/60">
                      <summary className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5">
                        <span className="font-mono text-meta uppercase tracking-[0.1em] text-muted-foreground">
                          {l2}
                        </span>
                        <span className="ml-auto font-mono text-meta text-muted-foreground">
                          {qs.length}
                        </span>
                      </summary>
                      <ul className="space-y-4 border-t border-border px-3.5 py-3.5">
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
                                      <p className="text-meta text-muted-foreground">
                                        ↳ {k.text}
                                      </p>
                                      <QuestionAnswers
                                        rows={answersByQuestion.get(k.id) ?? []}
                                      />
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
            {generalInsights.length} in {insightGroups.length} kinds
          </p>
        </div>

        {insightGroups.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          <div className="space-y-2">
            {insightGroups.map(([kind, rows]) => (
              <details
                key={kind}
                                className="rounded-lg border border-border bg-surface"
              >
                <summary className="flex cursor-pointer items-center gap-3 px-5 py-3.5">
                  <span className="text-section">{KIND_LABEL[kind] ?? kind}</span>
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
                      {i.evidence && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-accent">
                            {i.evidenceKind === "image" ? "From image" : "From text"}
                          </summary>
                          <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">
                            {i.evidence}
                          </p>
                        </details>
                      )}
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
