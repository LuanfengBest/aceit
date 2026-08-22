import { db } from "@/lib/db";
import { inboxItems, type InboxItem } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { WorkShell } from "@/components/work-shell";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<InboxItem["status"], string> = {
  pending: "待处理",
  processed: "已处理",
  failed: "失败",
};

// 待处理是唯一需要我动手的状态，所以只有它吃强调色
const STATUS_STYLE: Record<InboxItem["status"], string> = {
  pending: "bg-accent-soft text-accent",
  processed: "bg-surface-2 text-muted-foreground",
  failed: "bg-surface-2 text-danger",
};

const pad = (n: number) => String(n).padStart(2, "0");

// 不用 toLocaleString：服务端渲染时它跟着服务器 locale 走，输出不稳定
function formatDateTime(date: Date | null) {
  if (!date) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

export default async function InboxPage() {
  const items = db
    .select()
    .from(inboxItems)
    .orderBy(desc(inboxItems.createdAt))
    .all();

  const pendingCount = items.filter((i) => i.status === "pending").length;

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
          here — Aceit pulls out <span className="text-foreground">the questions they asked</span>,{" "}
          <span className="text-foreground">how the good answers were structured</span>, and
          anything worth knowing about that company, then files it next to your own material.
        </p>
        <p className="mt-3 font-mono text-meta text-muted-foreground">
          OR HIT ⌘⇧S ON ANY 小红书 NOTE WITH THE EXTENSION
        </p>
      </div>

      <div className="mb-4 flex items-baseline justify-between">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Signals
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {items.length} total{pendingCount > 0 && ` · ${pendingCount} to process`}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full table-fixed border-collapse text-body">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-meta text-muted-foreground">
              <th className="px-5 py-2.5 font-normal">标题</th>
              <th className="w-32 px-5 py-2.5 font-normal">作者</th>
              <th className="w-20 px-5 py-2.5 font-normal">类型</th>
              <th className="w-24 px-5 py-2.5 font-normal">状态</th>
              <th className="w-32 px-5 py-2.5 font-normal">发布</th>
              <th className="w-40 px-5 py-2.5 font-normal">入库</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="h-row border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <td className="truncate px-5">
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                    >
                      {item.title || "(无标题)"}
                    </a>
                  ) : (
                    item.title || "(无标题)"
                  )}
                </td>
                <td className="truncate px-5 text-muted-foreground">
                  {item.author || "—"}
                </td>
                <td className="px-5 text-meta text-muted-foreground">
                  {item.type === "video" ? "视频" : "图文"}
                </td>
                <td className="px-5">
                  <span
                    className={`inline-flex items-center rounded-pill px-2 py-0.5 text-meta ${
                      STATUS_STYLE[item.status]
                    }`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 text-meta text-muted-foreground">
                  {formatDate(item.publishedAt)}
                </td>
                <td className="whitespace-nowrap px-5 text-meta text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {items.length === 0 && (
          <p className="px-5 py-10 text-center text-meta text-muted-foreground">
            No signals yet. Paste a link or a block of text — anything you&rsquo;d otherwise
            screenshot and forget.
          </p>
        )}
      </div>
    </WorkShell>
  );
}
