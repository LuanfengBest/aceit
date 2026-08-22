"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";

export interface DigestRow {
  id: number;
  title: string;
  sourceUrl: string | null;
  /** 视频转出来的文字，没有就是 null */
  transcript: string | null;
  status: "pending" | "processed" | "failed";
  type: "normal" | "video";
  imageCount: number;
  questionCount: number;
  insightCount: number;
}

const STATUS_TONE: Record<DigestRow["status"], string> = {
  pending: "bg-peach text-peach-ink",
  processed: "bg-mint text-mint-ink",
  failed: "bg-surface-2 text-danger",
};

const STATUS_LABEL: Record<DigestRow["status"], string> = {
  pending: "To digest",
  processed: "Digested",
  failed: "Failed",
};

/** 一页最多显示多少条信号，多的翻页 */
const PAGE_SIZE = 15;

export function DigestPanel({ rows }: { rows: DigestRow[] }) {
  const router = useRouter();
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // 删素材会让页数变少，停在不存在的页上就成空白了
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const pending = rows.filter((r) => r.status !== "processed");

  async function consolidate(silent = false) {
    try {
      const res = await fetch("/api/inbox/consolidate", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLog((l) => [
        `整理：${body.insights} 条通用知识归成 ${body.topics} 个主题，合并 ${body.merged} 条；题去重 ${body.questionsMerged} 条`,
        ...l,
      ]);
      router.refresh();
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function digest(id: number) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${id}/digest`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setLog((l) => [
        `#${id} ${body.company || "—"} · 读了 ${body.imagesRead} 张图 · ${body.questions} 题 / ${body.insights} 条知识`,
        ...l,
      ]);
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  // 串行跑，避免一次打太多请求
  async function digestAll() {
    const ids = pending.map((r) => r.id);
    setQueue(ids);
    for (const id of ids) {
      await digest(id);
      setQueue((q) => q.filter((x) => x !== id));
    }
    setQueue([]);
    // 全部消化完再整理一次：归主题需要看到全局，逐条整理没意义
    setBusy(-1);
    await consolidate();
    setBusy(null);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
          Signals
        </p>
        <p className="font-mono text-meta text-muted-foreground">
          {rows.length} total · {pending.length} to digest
        </p>
        <span className="ml-auto" />
        <button
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(-1);
            setError(null);
            await consolidate();
            setBusy(null);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-meta text-muted-foreground transition-colors hover:border-accent disabled:opacity-40"
        >
          {busy === -1 ? "Tidying…" : "Dedupe & group"}
        </button>
        <button
          type="button"
          disabled={busy !== null || pending.length === 0}
          onClick={() => void digestAll()}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-meta text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {queue.length > 0
            ? `Digesting… ${pending.length - queue.length}/${pending.length}`
            : `Digest all (${pending.length})`}
        </button>
      </div>

      {error && <p className="mb-3 text-meta text-danger">{error}</p>}

      {log.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-md border border-border bg-surface-2 p-4">
          {log.slice(0, 6).map((l, i) => (
            <li key={i} className="font-mono text-meta text-muted-foreground">
              {l}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full table-fixed border-collapse text-body">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-meta text-muted-foreground">
              <th className="px-5 py-2.5 font-normal">Source</th>
              <th className="w-20 px-5 py-2.5 font-normal">Type</th>
              <th className="w-24 px-5 py-2.5 font-normal">Status</th>
              <th className="w-20 px-5 py-2.5 font-normal">Qs</th>
              <th className="w-24 px-5 py-2.5 font-normal">Insights</th>
              <th className="w-24 px-5 py-2.5 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <Fragment key={row.id}>
              <tr
                className="h-row border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
              >
                <td className="truncate px-5">
                  {row.sourceUrl ? (
                    <a
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-border underline-offset-4 transition-colors hover:decoration-accent"
                    >
                      {row.title} ↗
                    </a>
                  ) : (
                    row.title
                  )}
                </td>
                <td className="px-5 text-meta text-muted-foreground">
                  {row.type === "video" ? "Video" : `${row.imageCount} imgs`}
                </td>
                <td className="px-5">
                  <span className={`rounded-pill px-2.5 py-0.5 text-meta ${STATUS_TONE[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td className="px-5 font-mono text-meta text-muted-foreground">
                  {row.questionCount || "—"}
                </td>
                <td className="px-5 font-mono text-meta text-muted-foreground">
                  {row.insightCount || "—"}
                </td>
                <td className="px-5 text-right">
                  {row.transcript && (
                    <button
                      type="button"
                      onClick={() => setOpenRow(openRow === row.id ? null : row.id)}
                      className="mr-1 rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      {openRow === row.id ? "收起" : "转写"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={async () => {
                      const ok = await digest(row.id);
                      if (ok) {
                        setBusy(-1);
                        await consolidate(true);
                        setBusy(null);
                      }
                    }}
                    className="rounded-md px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
                  >
                    {busy === row.id
                      ? "…"
                      : row.status === "processed"
                        ? "Redo"
                        : "Digest"}
                  </button>
                </td>
              </tr>
              {openRow === row.id && row.transcript && (
                <tr className="border-b border-border bg-surface-2 last:border-b-0">
                  <td colSpan={6} className="px-5 py-4">
                    <p className="mb-2 font-mono text-meta uppercase tracking-[0.12em] text-muted-foreground">
                      Whisper transcript · {row.transcript.length} 字
                    </p>
                    <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-meta text-muted-foreground">
                      {row.transcript}
                    </p>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-2.5 flex items-center gap-3">
          <p className="font-mono text-meta text-muted-foreground">
            {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + visibleRows.length} of{" "}
            {rows.length}
          </p>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 0}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-35 disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              ←
            </button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                className={`min-w-[1.75rem] rounded-md border px-2 py-1 font-mono text-meta transition-colors ${
                  i === safePage
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                }`}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= pageCount - 1}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-meta text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-35 disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
