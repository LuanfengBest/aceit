import { desc, eq } from "drizzle-orm";
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

  const allInsights = db
    .select()
    .from(insights)
    .orderBy(desc(insights.id))
    .all();

  const inboxQuestions = db
    .select()
    .from(questions)
    .where(eq(questions.source, "inbox"))
    .all();

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
      insightCount: allInsights.filter((i) => i.inboxItemId === item.id).length,
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
            <p className="font-mono text-meta text-muted-foreground">{allInsights.length}</p>
          </div>
          {allInsights.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-5 py-8 text-center text-meta text-muted-foreground">
              Nothing yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {allInsights.slice(0, 20).map((i) => (
                <li key={i.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-pill px-2.5 py-0.5 text-meta ${KIND_TONE[i.kind]}`}>
                      {KIND_LABEL[i.kind]}
                    </span>
                    {i.company && (
                      <span className="font-mono text-meta text-muted-foreground">
                        {i.company}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-body">{i.title}</p>
                  <p className="mt-1 text-meta text-muted-foreground">{i.content}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </WorkShell>
  );
}
