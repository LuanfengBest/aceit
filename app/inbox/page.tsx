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

export default async function InboxPage() {
  const items = db
    .select()
    .from(inboxItems)
    .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
    .all();

  // 只取没被归并掉的，并带上来源笔记的标题和链接
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

  // 按主题聚合，条数多的主题排前面
  const byTopic = new Map<string, typeof allInsights>();
  for (const row of allInsights) {
    const key = row.insight.topic ?? "未分类";
    byTopic.set(key, [...(byTopic.get(key) ?? []), row]);
  }
  const topics = [...byTopic.entries()].sort((a, b) => b[1].length - a[1].length);

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
      questionCount: 0, // 面经题不挂 inbox_item，统计放在下面汇总
      insightCount: allInsights.filter((r) => r.insight.inboxItemId === item.id).length,
    };
  });

  return (
    <WorkShell
      meta="Layer 02"
      title="Inbox"
      subtitle="Paste anything useful you run into. Aceit reads it so you don't have to remember it."
      image="/images/work-3.jpg"
      field="inbox"
    >
      <div className="mb-5 rounded-lg border border-border bg-surface-2 p-5">
        <p className="text-body">
          Found an interview debrief? A teardown of the team you&rsquo;re about to meet? Drop it
          here — Aceit reads it (<span className="text-foreground">including the text inside
          screenshots</span>), pulls out{" "}
          <span className="text-foreground">the questions they asked</span> and{" "}
          <span className="text-foreground">how the good answers were structured</span>, then files
          them next to your own material.
        </p>
        <p className="mt-3 font-mono text-meta text-muted-foreground">
          ⌘⇧S ON ANY 小红书 NOTE WITH THE EXTENSION
        </p>
      </div>

      <DigestPanel rows={rows} />

      {/* 消化产出 */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
              Questions from the wild
            </p>
            <p className="font-mono text-meta text-muted-foreground">
              {inboxQuestions.length}
            </p>
          </div>
          {inboxQuestions.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
              Nothing yet. Digest a signal above.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {inboxQuestions.slice(0, 24).map((q) => (
                <li
                  key={q.id}
                  className="rounded-lg border border-border bg-surface px-4 py-3 text-body"
                >
                  {q.text}
                  {q.clusterId && (
                    <span className="ml-2 font-mono text-meta text-muted-foreground">
                      {q.clusterId}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
              What to steal
            </p>
            <p className="font-mono text-meta text-muted-foreground">
              {allInsights.length} in {topics.length} topics
            </p>
          </div>

          {topics.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
              Nothing yet.
            </p>
          ) : (
            <div className="space-y-2">
              {topics.map(([topic, rows]) => (
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
                          <span
                            className={`rounded-pill px-2.5 py-0.5 text-meta ${KIND_TONE[i.kind]}`}
                          >
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
                              className="ml-auto max-w-[14rem] truncate text-meta text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                            >
                              {sourceTitle || "原文"} ↗
                            </a>
                          ) : (
                            sourceTitle && (
                              <span className="ml-auto max-w-[14rem] truncate text-meta text-muted-foreground">
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
    </WorkShell>
  );
}
